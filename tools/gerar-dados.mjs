#!/usr/bin/env node
// Gera data.js a partir das respostas do Strava e dos treinos do TrainingPeaks.
// Uso: node tools/gerar-dados.mjs <pasta-com-jsons>
// A pasta deve ter: atividades.json (Strava list_activities first=100),
// prova.json (list_activities do dia 2026-10-18), recordes.json (get_athlete_best_efforts),
// zonas.json (get_athlete_zones) e treinos.json ({tpAtualizado, tpTreinos[], tpDescanso[]}).
import fs from 'fs';
import path from 'path';
const dir = process.argv[2] || '/tmp/tri';
const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const L = {}, C = {};
const window = {};
const dash = { loader: (id, o) => (L[id] = o.fn), calc: (id, o) => (C[id] = o) };

/* ---------- leitores: respostas do Strava em linhas ---------- */
const parse = (answer) => {
let a = answer;
if (Array.isArray(a) && a[0] && typeof a[0].text === 'string') a = a[0].text;
if (a && a.content && Array.isArray(a.content) && a.content[0] && a.content[0].text) a = a.content[0].text;
if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { throw new Error(a.slice(0, 300)); } }
if (a && a.error) throw new Error(typeof a.error === 'string' ? a.error : (a.error.message || 'Erro do Strava'));
return a;
};
window.triParse = parse;
const ATIV_COLS = ['id','inicio','dia','tipo','nome','local','distancia_km','natacao_m','tempo_mov_s','tempo_total_s','elevacao_m','vel_kmh','ritmo_s_km','ritmo_s_100m','esforco','kcal','temp_c','sensacao_c','vento_kmh','vento_dir','umidade','clima'];
const ativRows = (a) => ((a && a.activities) || []).map((x) => {
const s = x.summary || {}, w = x.weather || {};
return {id: String(x.id), inicio: x.start_local, dia: String(x.start_local || '').slice(0, 10), tipo: x.sport_type, nome: x.name, local: x.location_summary || null,
distancia_km: s.distance ?? null, natacao_m: s.swim_distance ?? null, tempo_mov_s: s.moving_time ?? null, tempo_total_s: s.elapsed_time ?? null,
elevacao_m: s.elevation_gain ?? null, vel_kmh: s.avg_speed ?? null, ritmo_s_km: s.avg_pace ?? null, ritmo_s_100m: s.avg_swim_pace ?? null,
esforco: s.relative_effort ?? null, kcal: s.total_calories ?? null, temp_c: w.temperature ?? null, sensacao_c: w.feels_like ?? null,
vento_kmh: w.wind_speed ?? null, vento_dir: w.wind_direction ?? null, umidade: w.humidity ?? null, clima: w.condition ?? null};
});
dash.loader('atividades', {description: 'Atividades do Strava, uma linha por treino (unidades métricas)', fn: ({answer}) => {
const a = window.triParse(answer);
return {columns: ATIV_COLS, rows: ativRows(a), cut: false};
}});
dash.loader('prova_703', {description: 'Atividades do dia da prova, uma linha por etapa', fn: ({answer}) => {
const a = window.triParse(answer);
return {columns: ATIV_COLS, rows: ativRows(a), cut: false};
}});
dash.loader('recordes', {description: 'Melhores esforços do Strava, um por linha', fn: ({answer}) => {
const a = window.triParse(answer);
return {columns: ['tipo','esporte','valor','unidade','data'], rows: ((a && a.efforts) || []).map((e) => ({tipo: e.best_effort_type, esporte: e.sport, valor: e.value, unidade: e.unit, data: e.date}))};
}});
dash.loader('zonas', {description: 'Zonas de FC e FTP do Strava, uma linha por zona', fn: ({answer}) => {
const a = window.triParse(answer);
const rows = (a.heart_rate_zones || []).map((z, i) => ({grupo: 'FC', zona: i + 1, min: z.min ?? null, max: z.max ?? null}));
if (a.ftp != null) rows.push({grupo: 'FTP', zona: 0, min: a.ftp, max: a.ftp});
return {columns: ['grupo','zona','min','max'], rows};
}});


/* ---------- cálculos ---------- */
dash.calc('periodo', {inputs: ['atividades'], title: '4 semanas vs 4 anteriores', description: 'Somas dos 28 dias até o último treino e dos 28 dias antes deles, com a variação.', fn: (atividades) => {
const ref = atividades.reduce((m, r) => (r.dia > m ? r.dia : m), '');
const t0 = Date.parse(ref + 'T00:00:00Z');
const idade = (r) => (t0 - Date.parse(r.dia + 'T00:00:00Z')) / 864e5;
const mod = (t) => (t === 'Swim' ? 'nat' : /Ride/.test(t) ? 'bike' : /Run/.test(t) ? 'run' : 'outro');
const metricas = {horas: (r) => (r.tempo_mov_s || 0) / 3600, natacao_km: (r) => (mod(r.tipo) === 'nat' ? r.distancia_km : 0), ciclismo_km: (r) => (mod(r.tipo) === 'bike' ? r.distancia_km : 0), corrida_km: (r) => (mod(r.tipo) === 'run' ? r.distancia_km : 0), esforco: (r) => r.esforco || 0};
return Object.entries(metricas).map(([metrica, f]) => {
const soma = (a, b) => atividades.filter((r) => idade(r) >= a && idade(r) < b).reduce((s, r) => s + (f(r) || 0), 0);
const atual = Math.round(soma(0, 28) * 10) / 10, anterior = Math.round(soma(28, 56) * 10) / 10;
return {metrica, atual, anterior, variacao: anterior ? Math.round(((atual - anterior) / anterior) * 1000) / 1000 : null};
});
}});
dash.calc('semanas', {inputs: ['atividades'], title: 'Horas por semana e modalidade', description: 'Horas em movimento e esforço relativo por semana (segunda a domingo), 12 semanas.', fn: (atividades) => {
const seg = (d) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
const mod = (t) => (t === 'Swim' ? 'natacao_h' : /Ride/.test(t) ? 'ciclismo_h' : /Run/.test(t) ? 'corrida_h' : 'outros_h');
const fim = seg(atividades.reduce((m, r) => (r.dia > m ? r.dia : m), ''));
const semanas = [];
for (let i = 11; i >= 0; i--) { const x = new Date(fim + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - 7 * i); semanas.push(x.toISOString().slice(0, 10)); }
const base = Object.fromEntries(semanas.map((s) => [s, {semana: s, natacao_h: 0, ciclismo_h: 0, corrida_h: 0, outros_h: 0, esforco: 0}]));
atividades.forEach((r) => { const b = base[seg(r.dia)]; if (!b) return; b[mod(r.tipo)] += (r.tempo_mov_s || 0) / 3600; b.esforco += r.esforco || 0; });
return semanas.map((s) => { const b = base[s]; ['natacao_h', 'ciclismo_h', 'corrida_h', 'outros_h'].forEach((k) => (b[k] = Math.round(b[k] * 100) / 100)); return b; });
}});
dash.calc('carga', {inputs: ['atividades'], title: 'Carga aguda vs crônica', description: 'Esforço dos últimos 7 dias dividido pela média semanal dos últimos 28.', fn: (atividades) => {
const ate = atividades.reduce((m, r) => (r.dia > m ? r.dia : m), '');
const t0 = Date.parse(ate + 'T00:00:00Z');
const soma = (dias) => atividades.filter((r) => (t0 - Date.parse(r.dia + 'T00:00:00Z')) / 864e5 < dias).reduce((s, r) => s + (r.esforco || 0), 0);
const agudo = soma(7), cronico = Math.round(soma(28) / 4);
const razao = cronico ? Math.round((agudo / cronico) * 100) / 100 : null;
const status = razao == null ? null : razao < 0.8 ? 'abaixo do ideal' : razao <= 1.3 ? 'na faixa ideal' : razao <= 1.5 ? 'em atenção' : 'alta, risco de lesão';
return [{ate, agudo, cronico, razao, status}];
}});
dash.calc('ritmos', {inputs: ['atividades'], title: 'Ritmo médio por semana', description: 'Corrida em s/km, natação em s/100 m e ciclismo na rua em km/h, ponderados pelo tempo.', fn: (atividades) => {
const seg = (d) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
const g = {};
atividades.forEach((r) => {
const s = (g[seg(r.dia)] ||= {semana: seg(r.dia), rt: 0, rd: 0, nt: 0, nm: 0, bt: 0, bd: 0});
if (r.tipo === 'Run' && r.distancia_km > 0) { s.rt += r.tempo_mov_s; s.rd += r.distancia_km; }
if (r.tipo === 'Swim' && r.natacao_m > 0) { s.nt += r.tempo_mov_s; s.nm += r.natacao_m; }
if (r.tipo === 'Ride' && r.distancia_km > 0) { s.bt += r.tempo_mov_s; s.bd += r.distancia_km; }
});
return Object.values(g).sort((a, b) => (a.semana < b.semana ? -1 : 1)).slice(-12).map((s) => ({semana: s.semana,
corrida_s_km: s.rd ? Math.round(s.rt / s.rd) : null, natacao_s_100m: s.nm ? Math.round(s.nt / (s.nm / 100)) : null, ciclismo_kmh: s.bt ? Math.round((s.bd / (s.bt / 3600)) * 10) / 10 : null}));
}});
dash.calc('corridas_clima', {inputs: ['atividades'], title: 'Corridas com clima', description: 'Corridas de 3 km ou mais que têm temperatura registrada.', fn: (atividades) =>
atividades.filter((r) => r.tipo === 'Run' && r.distancia_km >= 3 && r.temp_c != null && r.ritmo_s_km > 0)
.map((r) => ({id: r.id, dia: r.dia, temp_c: r.temp_c, umidade: r.umidade, ritmo_s_km: Math.round(r.ritmo_s_km), distancia_km: Math.round(r.distancia_km * 10) / 10}))
});
dash.calc('efeito_calor', {inputs: ['corridas_clima'], title: 'Efeito do calor no ritmo', description: 'Inclinação da reta de mínimos quadrados do ritmo contra a temperatura.', fn: (corridas_clima) => {
const n = corridas_clima.length;
if (n < 4) return [{n, seg_por_grau: null, a: null, b: null}];
const mx = corridas_clima.reduce((s, r) => s + r.temp_c, 0) / n, my = corridas_clima.reduce((s, r) => s + r.ritmo_s_km, 0) / n;
const sxy = corridas_clima.reduce((s, r) => s + (r.temp_c - mx) * (r.ritmo_s_km - my), 0), sxx = corridas_clima.reduce((s, r) => s + (r.temp_c - mx) ** 2, 0);
const b = sxx ? sxy / sxx : 0;
return [{n, seg_por_grau: Math.round(b * 10) / 10, a: Math.round((my - b * mx) * 10) / 10, b: Math.round(b * 100) / 100}];
}});
dash.calc('prova', {inputs: ['prova_703'], title: 'Parciais do 70.3', description: 'Tempos de cada etapa e transições pelos horários das atividades do dia da prova.', fn: (prova_703) => {
const META_S = 5 * 3600;
const ord = [...prova_703].sort((a, b) => (a.inicio < b.inicio ? -1 : 1));
const nat = ord.find((r) => r.tipo === 'Swim'), bike = ord.find((r) => /Ride/.test(r.tipo)), run = ord.find((r) => /Run/.test(r.tipo) && r.distancia_km > 15);
if (!nat || !bike || !run) return [];
const t = (s) => Date.parse(s + 'Z') / 1000;
const gap = (a, b) => { const v = t(b.inicio) - (t(a.inicio) + a.tempo_total_s); return v >= 0 ? v : null; };
const mmss = (s) => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
const total = t(run.inicio) + run.tempo_total_s - t(nat.inicio);
const dif = total - META_S;
return [
{etapa: 'Natação', tempo_s: nat.tempo_total_s, detalhe: Math.round(nat.natacao_m) + ' m · ' + mmss(nat.tempo_total_s / (nat.natacao_m / 100)) + '/100 m'},
{etapa: 'T1', tempo_s: gap(nat, bike), detalhe: 'transição'},
{etapa: 'Ciclismo', tempo_s: bike.tempo_total_s, detalhe: String(Math.round(bike.distancia_km * 10) / 10).replace('.', ',') + ' km · ' + String(Math.round((bike.distancia_km / (bike.tempo_total_s / 3600)) * 10) / 10).replace('.', ',') + ' km/h'},
{etapa: 'T2', tempo_s: gap(bike, run), detalhe: 'transição'},
{etapa: 'Corrida', tempo_s: run.tempo_total_s, detalhe: String(Math.round(run.distancia_km * 10) / 10).replace('.', ',') + ' km · ' + mmss(run.tempo_total_s / run.distancia_km) + '/km'},
{etapa: 'Total', tempo_s: total, detalhe: (dif > 0 ? '+' : '−') + mmss(Math.abs(dif)) + ' em relação à meta de 5h'},
];
}});
dash.calc('recentes', {inputs: ['atividades'], title: 'Últimos 15 treinos', description: 'Os treinos mais recentes, com o ritmo na unidade de cada modalidade.', fn: (atividades) => {
const nome = {Swim: 'Natação', Ride: 'Ciclismo', VirtualRide: 'Rolo', Run: 'Corrida', TrailRun: 'Trail', HighIntensityIntervalTraining: 'Funcional', WeightTraining: 'Musculação', Walk: 'Caminhada'};
const mmss = (s) => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
return [...atividades].sort((a, b) => (a.inicio < b.inicio ? 1 : -1)).slice(0, 15).map((r) => ({
id: r.id, dia: r.dia, modalidade: nome[r.tipo] || r.tipo,
distancia: r.tipo === 'Swim' ? Math.round(r.natacao_m || 0) + ' m' : r.distancia_km ? String(Math.round(r.distancia_km * 10) / 10).replace('.', ',') + ' km' : null,
tempo_s: r.tempo_mov_s,
ritmo: r.tipo === 'Swim' && r.ritmo_s_100m ? mmss(r.ritmo_s_100m) + '/100 m' : /Run/.test(r.tipo) && r.ritmo_s_km ? mmss(r.ritmo_s_km) + '/km' : /Ride/.test(r.tipo) && r.vel_kmh ? String(Math.round(r.vel_kmh * 10) / 10).replace('.', ',') + ' km/h' : null,
esforco: r.esforco, temp_c: r.temp_c, vento_kmh: r.vento_kmh == null ? null : Math.round(r.vento_kmh)}));
}});

const at = L.atividades({ answer: rd('atividades.json') }).rows;
const D = { atividades: at, prova_703: L.prova_703({ answer: rd('prova.json') }).rows };
const strava = { geradoEm: new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 16) };
for (const id of ['periodo', 'semanas', 'carga', 'ritmos', 'corridas_clima', 'efeito_calor', 'prova', 'recentes']) {
  const c = C[id]; D[id] = c.fn(...c.inputs.map((i) => D[i])); strava[id] = D[id];
}
// histórico compacto dos últimos 42 dias (para as sugestões de treino)
{
  const ref = at.reduce((m, r) => (r.dia > m ? r.dia : m), '');
  const lim = new Date(Date.parse(ref + 'T00:00:00Z') - 42 * 864e5).toISOString().slice(0, 10);
  strava.historico = at.filter((r) => r.dia >= lim).sort((a, b) => (a.inicio < b.inicio ? -1 : 1))
    .map((r) => [r.dia, r.tipo, Math.round((r.tempo_mov_s || 0) / 60), r.tipo === 'Swim' ? Math.round(r.natacao_m || 0) : Math.round((r.distancia_km || 0) * 10) / 10, r.esforco ?? null, r.tipo === 'Swim' ? (r.ritmo_s_100m ? Math.round(r.ritmo_s_100m) : null) : (r.ritmo_s_km ? Math.round(r.ritmo_s_km) : null), +String(r.inicio).slice(11, 13)]);
}
strava.corridas_clima = strava.corridas_clima.map((r) => [r.temp_c, r.ritmo_s_km, r.dia]);
const rec = window.triParse(rd('recordes.json'));
strava.recordes = (rec.efforts || []).filter((e) => e.unit === 'seconds' || e.unit === 'watts')
  .map((e) => [e.best_effort_type, e.value, e.unit === 'seconds' ? 's' : 'W', e.date]);
const z = window.triParse(rd('zonas.json'));
strava.zonas = { ftp: z.ftp, fc: (z.heart_rate_zones || []).map((h) => [h.min, h.max ?? null]), corrida_ms: (z.run_zones || []).map((h) => [h.min ?? null, h.max ?? null]) };
const tp = rd('treinos.json');
const data = { geradoEm: strava.geradoEm, tpAtualizado: tp.tpAtualizado, tpTreinos: tp.tpTreinos || [], tpDescanso: tp.tpDescanso || [], strava };
fs.writeFileSync(new URL('../data.js', import.meta.url), '// Gerado automaticamente. Não edite à mão.\nwindow.TRI_DATA = ' + JSON.stringify(data, null, 1) + ';\n');
console.log('data.js ok:', at.length, 'atividades,', data.tpTreinos.length, 'treinos TP');
