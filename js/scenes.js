// Scene layout: picks a mm-per-cell scale so projectile + target fit, paints the target,
// and stages the projectile.

import { PROJ, TARGET, Painter, rasterizeProjectile } from './shapes.js';

export function buildScene(world, { proj, target, angle = 0, speed }) {
  const P = PROJ[proj], T = TARGET[target];
  const tAngle = T.angled ? angle : 0;
  const sz = T.size(tAngle);
  const Lp = P.len;
  const W = world.W, H = world.H;
  const needW = (Lp + sz.w) / (T.ground ? 0.8 : 0.62);
  const needH = sz.h / (T.ground ? 0.92 : 0.8);
  let cellMM = Math.max(needW / W, needH / H);
  // round to a "nice" value so the ruler is readable
  cellMM = niceCeil(cellMM);
  world.clear();
  world.cellMM = cellMM;
  const Wmm = W * cellMM, Hmm = H * cellMM;
  const tx = Wmm * (T.ground ? 0.985 : 0.86) - sz.w;
  const ty = T.ground ? Hmm - sz.h : (Hmm - sz.h) / 2;
  const painter = new Painter(world, tx, ty);
  T.build(painter, tAngle, sz);

  const sprite = rasterizeProjectile(P, cellMM);
  const noseMM = Math.max(Lp + Wmm * 0.02, tx - Math.max(Wmm * (P.speed < 700 ? 0.05 : T.ground ? 0.1 : 0.22), 30 * cellMM));
  const yMM = ty + sz.aim;
  const v = speed || P.speed;
  const los = T.angled && sz.los !== false ? losThickness(T, tAngle) : null;
  // pull the shooter up to a fixed stand-off in front of the first solid cell on the aim line,
  // so slow munitions don't spend seconds crossing empty air
  let noseCell = noseMM / cellMM;
  const row = Math.round(yMM / cellMM);
  if (row >= 0 && row < H) {
    let xs = -1;
    for (let x = Math.ceil(noseCell) + 1; x < W; x++) if (world.st[row * W + x]) { xs = x; break; }
    const gap = Math.max(14, W * (v < 700 ? 0.04 : 0.07));
    if (xs > 0 && xs - noseCell > gap) noseCell = Math.max(noseCell, xs - gap);
  }
  return {
    proj: P, target: T, angle: tAngle, speed: v, cellMM,
    shot: {
      sprite, x: noseCell, y: yMM / cellMM, angle: 0, speed: v,
      def: { charges: (P.fuze && P.fuze.charges) || [], fuzeSens: (P.fuze && P.fuze.fuzeSens) || 0.05, eff: P.eff || 1 },
    },
    targetBox: { x: tx / cellMM, y: ty / cellMM, w: sz.w / cellMM, h: sz.h / cellMM },
    losMM: los,
  };
}

function losThickness(T, angle) {
  // thickness of material along a horizontal line through the plate (excluding air gaps)
  const k = T.key;
  const c = Math.cos(angle * Math.PI / 180);
  const m = /^(?:rha|alu|hhs)(\d+)$/.exec(k);
  if (m) return +m[1] / c;
  if (k === 'bedrock') return 80 / c;
  return null;
}

function niceCeil(x) {
  const steps = [0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10, 12, 14, 16, 18, 20, 22.5, 25, 30, 40, 50, 60, 75, 80, 100];
  for (const s of steps) if (s >= x * 0.999) return s;
  return Math.ceil(x);
}

export const EXPERIMENTS = [
  { key: 'e1', proj: '120dm53', target: 'rha700', angle: 0, ru: ['DM53 против 700 мм RHA', 'Вольфрамовый лом 1670 м/с срабатывается о броню — как настоящий БОПС.'], en: ['DM53 vs 700 mm RHA', 'A tungsten long rod at 1670 m/s erodes as it digs in.'] },
  { key: 'e2', proj: '125mango', target: 'rha400', angle: 60, ru: ['«Манго» против 400 мм под 60°', 'Приведённая толщина — 800 мм. Хватит ли энергии?'], en: ['Mango vs 400 mm at 60°', 'Line-of-sight thickness is 800 mm. Will it make it?'] },
  { key: 'e3', proj: '120m829a3', target: 'composite', angle: 0, ru: ['Урановый БОПС против композита', 'Керамика сильнее изнашивает сердечник, чем сталь.'], en: ['DU rod vs composite', 'Ceramic erodes the rod faster than steel does.'] },
  { key: 'e4', proj: '120dm53', target: 'rha100', angle: 80, ru: ['Рикошет: БОПС под 80°', 'Слишком крутой угол — лом уходит вскользь.'], en: ['Ricochet: rod at 80°', 'Too steep — the rod glances off.'] },
  { key: 'e5', proj: '88pzgr39', target: 't3485', angle: 0, ru: ['Тигр стреляет по Т-34-85', 'Каморный снаряд с замедлением: пробил — и взорвался внутри.'], en: ['Tiger shoots a T-34-85', 'APHE with a delay fuze: in, then boom.'] },
  { key: 'e6', proj: '85br365', target: 'tiger', angle: 0, ru: ['Т-34-85 против лба Тигра', 'Литой 100 мм лоб башни Тигра и 85-мм БР-365.'], en: ['T-34-85 vs Tiger front', 'Tiger\'s 100 mm mantlet vs the 85 mm BR-365.'] },
  { key: 'e7', proj: '122br471', target: 'tiger', angle: 0, ru: ['ИС-2 по Тигру', '25-килограммовая болванка 122 мм.'], en: ['IS-2 vs Tiger', 'A 25 kg 122 mm shot.'] },
  { key: 'e8', proj: '76m62', target: 'sherman', angle: 0, ru: ['Шерман против Шермана', '76 мм против 64 мм под 47°.'], en: ['Sherman vs Sherman', '76 mm vs 64 mm at 47°.'] },
  { key: 'e9', proj: '125bk18', target: 'rha400', angle: 0, ru: ['Кумулятивный 125 мм против 400 мм', 'Медная воронка схлопывается в струю 8 км/с.'], en: ['125 mm HEAT vs 400 mm', 'The copper liner collapses into an 8 km/s jet.'] },
  { key: 'e10', proj: 'pg7vl', target: 'era', angle: 0, ru: ['РПГ-7 против динамической защиты', 'Взрыв ДЗ рассеивает кумулятивную струю.'], en: ['RPG-7 vs ERA', 'The ERA blast disrupts the jet.'] },
  { key: 'e11', proj: 'kornet', target: 't72era', angle: 0, ru: ['«Корнет» против Т-72Б с ДЗ', 'Лидирующий заряд снимает ДЗ, основной — бьёт в броню.'], en: ['Kornet vs T-72B with ERA', 'The precursor clears the ERA, the main charge hits armour.'] },
  { key: 'e12', proj: '105hesh', target: 'rha100', angle: 0, ru: ['HESH против 100 мм', 'Пластит расплющивается по броне — с тыла летят откольные осколки.'], en: ['HESH vs 100 mm', 'Plastic explosive squashes on the plate — spall flies off the back.'] },
  { key: 'e13', proj: '152he', target: 'bunker', angle: 0, ru: ['152 мм ОФС по ДОТу', 'Фугасное действие и осколки.'], en: ['152 mm HE vs pillbox', 'Blast and fragments.'] },
  { key: 'e14', proj: '9mm', target: 'gel', angle: 0, ru: ['9 мм в баллистический гель', 'Классический тест пули.'], en: ['9 mm into gelatin', 'The classic bullet test.'] },
  { key: 'e15', proj: '762b32', target: 'b4cvest', angle: 0, ru: ['Б-32 против бронежилета', 'Карбид бора раскалывает сердечник.'], en: ['B-32 vs body armour', 'Boron carbide shatters the core.'] },
  { key: 'e16', proj: '145bs41', target: 'hhs30', angle: 0, ru: ['14,5 мм БС-41 против 30 мм', 'Карбид-вольфрамовый сердечник.'], en: ['14.5 mm BS-41 vs 30 mm', 'Tungsten-carbide core.'] },
  { key: 'e17', proj: '120m829a3', target: 't72b', angle: 0, ru: ['M829A3 по Т-72Б', 'Боекомплект в карусели...'], en: ['M829A3 vs T-72B', 'Ammo in the carousel...'] },
  { key: 'e18', proj: '125mango', target: 'm1a2', angle: 0, ru: ['«Манго» по M1A2', 'Урановая вставка в лбу башни.'], en: ['Mango vs M1A2', 'DU inserts in the turret front.'] },
  { key: 'e19', proj: 'railgun', target: 'leo2a6', angle: 0, ru: ['Рельсотрон по Leopard 2A6', '3 км/с — гидродинамический режим.'], en: ['Railgun vs Leopard 2A6', '3 km/s — hydrodynamic regime.'] },
  { key: 'e20', proj: '30apfsds', target: 'bmp1', angle: 0, ru: ['30 мм БОПС по БМП-1', 'Лёгкая броня против автоматической пушки.'], en: ['30 mm APFSDS vs BMP-1', 'Light armour vs autocannon.'] },
  { key: 'e21', proj: 'pg7vl', target: 'nera', angle: 0, ru: ['РПГ-7 против NERA', 'Пассивные сэндвичи сталь-резина.'], en: ['RPG-7 vs NERA', 'Passive steel-rubber sandwiches.'] },
  { key: 'e22', proj: 'meteor', target: 'concrete', angle: 0, ru: ['Метеорит против бетонной стены', '12 км/с. Без комментариев.'], en: ['Meteorite vs concrete wall', '12 km/s. No comment.'] },
  { key: 'e23', proj: 'goldbar', target: 'glass', angle: 0, ru: ['Золотой слиток против бронестекла', 'Дорого и бесполезно.'], en: ['Gold bar vs armoured glass', 'Expensive and pointless.'] },
  { key: 'e24', proj: 'pg7vl', target: 'watertank', angle: 0, ru: ['РПГ-7 по баку с водой', 'Струя в жидкости.'], en: ['RPG-7 vs water tank', 'A jet in liquid.'] },
  { key: 'e25', proj: '88pzgr39', target: 'spaced', angle: 0, ru: ['88 мм против разнесённой брони', 'Два листа по 40 мм с зазором.'], en: ['88 mm vs spaced armour', 'Two 40 mm plates with a gap.'] },
  { key: 'e26', proj: '152he', target: 'is2', angle: 0, ru: ['152 мм ОФС по ИС-2', 'Не пробьёт — но экипажу не поздоровится?'], en: ['152 mm HE vs IS-2', 'No penetration — but what about the crew?'] },
];
