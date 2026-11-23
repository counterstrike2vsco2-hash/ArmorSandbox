// Material database.
// Units (game-scaled, but kept in the right ballpark):
//   density  – g/cm3
//   R        – target resistance, GPa-equivalent (Tate-like strength term)
//   Y        – projectile yield strength, GPa (how hard it resists erosion)
//   hard     – relative hardness 0..10 (used for erosion / ricochet ratios)
//   brittle  – 0..1, shattering / cracking tendency
//   atten    – shock attenuation length, mm (how far a blast shock travels inside)
//   spall    – back-face spall threshold, GPa
//   melt     – °C (0 = never melts)
//   ignite   – °C at which it starts to burn / cook off (0 = inert)
//   burn     – burn rate (hp per heat tick while burning)
//   P0       – detonation pressure, GPa (0 = not explosive)
//   low      – true for propellants (deflagrate, weaker, more fire)
//   sens     – impact energy needed to initiate (same units as 0.5*rho*v^2)
//   state    – 'solid' | 'powder' | 'liquid' | 'gas'
//   cat      – UI category

export const STATE = { SOLID: 'solid', POWDER: 'powder', LIQUID: 'liquid', GAS: 'gas' };

const RAW = [
  // key,        ru,                          en,                       color,            dens,  R,     Y,    hard, brit, atten, spall, melt, ign, burn, P0, cat
  ['rha',        'Броня RHA (катаная)',        'RHA steel',              [118,124,132],    7.85,  3.9,  1.6,  5.0, 0.10, 170, 1.30, 1500, 0, 0, 0, 'metal'],
  ['hhs',        'Высокотвёрдая сталь',        'High-hard steel',        [140,146,160],    7.85,  5.0,  2.0,  6.2, 0.30, 160, 1.10, 1500, 0, 0, 0, 'metal'],
  ['cast',       'Литая броня',                'Cast armour steel',      [104,108,112],    7.80,  3.3,  1.3,  4.6, 0.20, 160, 1.00, 1450, 0, 0, 0, 'metal'],
  ['mild',       'Конструкционная сталь',      'Mild steel',             [150,150,146],    7.85,  2.4,  0.6,  3.4, 0.05, 170, 1.20, 1480, 0, 0, 0, 'metal'],
  ['alu',        'Алюминий 5083',              'Aluminium 5083',         [182,190,198],    2.66,  1.2,  0.3,  2.0, 0.05, 150, 0.80,  640, 0, 0, 0, 'metal'],
  ['ti',         'Титан',                      'Titanium',               [160,152,170],    4.50,  3.2,  1.0,  5.0, 0.12, 160, 1.20, 1660, 0, 0, 0, 'metal'],
  ['wha',        'Вольфрамовый сплав',         'Tungsten heavy alloy',   [74,78,92],      17.60,  4.6,  2.0,  7.0, 0.20, 180, 1.80, 3400, 0, 0, 0, 'metal'],
  ['du',         'Обеднённый уран',            'Depleted uranium',       [70,92,70],      19.00,  4.4,  1.8,  6.6, 0.15, 180, 1.60, 1130, 0, 0, 0, 'metal'],
  ['wc',         'Карбид вольфрама',           'Tungsten carbide',       [96,96,110],     15.60,  6.0,  3.6,  9.0, 0.60, 150, 0.90, 2870, 0, 0, 0, 'metal'],
  ['copper',     'Медь',                       'Copper',                 [205,120,70],     8.96,  1.5,  0.3,  2.6, 0.02, 170, 1.00, 1085, 0, 0, 0, 'metal'],
  ['lead',       'Свинец',                     'Lead',                   [100,104,116],   11.30,  0.3,  0.03, 1.0, 0.00, 120, 0.40,  327, 0, 0, 0, 'metal'],
  ['brass',      'Латунь / томпак',            'Brass / gilding metal',  [212,170,80],     8.50,  1.2,  0.3,  2.8, 0.03, 160, 0.90,  930, 0, 0, 0, 'metal'],
  ['gold',       'Золото',                     'Gold',                   [240,196,60],    19.30,  0.6,  0.1,  1.5, 0.00, 160, 0.60, 1064, 0, 0, 0, 'metal'],

  ['alumina',    'Керамика Al₂O₃',             'Alumina ceramic',        [226,222,206],    3.90,  6.0,  3.0,  9.0, 0.90,  60, 0.30, 2070, 0, 0, 0, 'ceramic'],
  ['b4c',        'Карбид бора',                'Boron carbide',          [70,70,76],       2.52,  7.0,  3.5,  9.5, 0.95,  60, 0.30, 2760, 0, 0, 0, 'ceramic'],
  ['glass',      'Стекло',                     'Glass',                  [170,220,230],    2.50,  1.6,  0.8,  5.5, 1.00,  40, 0.10, 1400, 0, 0, 0, 'ceramic'],
  ['diamond',    'Алмаз',                      'Diamond',                [200,240,255],    3.51, 10.0,  6.0, 10.0, 0.70,  80, 0.60,    0, 0, 0, 0, 'ceramic'],
  ['concrete',   'Бетон',                      'Concrete',               [150,146,136],    2.40,  0.7,  0.2,  4.0, 0.80,  40, 0.06,    0, 0, 0, 0, 'mineral'],
  ['rconcrete',  'Железобетон',                'Reinforced concrete',    [132,130,124],    2.50,  1.1,  0.3,  4.2, 0.55,  50, 0.12,    0, 0, 0, 0, 'mineral'],
  ['granite',    'Гранит',                     'Granite',                [128,110,104],    2.70,  1.4,  0.5,  6.0, 0.75,  50, 0.10,    0, 0, 0, 0, 'mineral'],
  ['brick',      'Кирпич',                     'Brick',                  [168,82,56],      1.90,  0.5,  0.15, 3.0, 0.80,  35, 0.05,    0, 0, 0, 0, 'mineral'],
  ['ice',        'Лёд',                        'Ice',                    [196,230,250],    0.92,  0.15, 0.05, 1.5, 0.85,  30, 0.02,    0, 0, 0, 0, 'mineral'],
  ['sand',       'Песок',                      'Sand',                   [214,190,130],    1.60,  0.08, 0.02, 6.0, 0.00,  15, 0.01,    0, 0, 0, 0, 'mineral'],

  ['wood',       'Дерево',                     'Wood',                   [150,104,62],     0.60,  0.25, 0.08, 1.2, 0.20,  40, 0.03,    0, 300, 0.012, 0, 'organic'],
  ['rubber',     'Резина',                     'Rubber',                 [44,44,48],       1.20,  0.40, 0.10, 0.5, 0.00,  25, 0.20,    0, 350, 0.008, 0, 'organic'],
  ['kevlar',     'Арамид (кевлар)',            'Aramid (Kevlar)',        [214,196,90],     1.44,  1.3,  0.5,  1.5, 0.00,  40, 0.40,    0, 450, 0.006, 0, 'organic'],
  ['uhmwpe',     'СВМПЭ',                      'UHMWPE',                 [236,236,228],    0.97,  0.9,  0.3,  1.0, 0.00,  40, 0.30,    0, 400, 0.008, 0, 'organic'],
  ['gel',        'Баллистический гель',        'Ballistic gelatin',      [236,206,150],    1.06,  0.004, 0.01, 0.3, 0.00,  20, 0.02,    0, 0, 0, 0, 'organic'],
  ['dummy',      'Манекен (экипаж)',           'Crash dummy (crew)',     [236,170,50],     1.05,  0.12, 0.04, 0.6, 0.05,  20, 0.03,    0, 600, 0.004, 0, 'organic'],

  ['water',      'Вода',                       'Water',                  [50,110,210],     1.00,  0.02, 0.0,  0.1, 0.00,  15, 0.01,    0, 0, 0, 0, 'liquid'],
  ['diesel',     'Дизельное топливо',          'Diesel fuel',            [160,120,40],     0.85,  0.02, 0.0,  0.1, 0.00,  15, 0.01,    0, 220, 0.010, 0, 'liquid'],
  ['napalm',     'Напалм',                     'Napalm',                 [230,110,30],     0.90,  0.03, 0.0,  0.1, 0.00,  15, 0.01,    0, 150, 0.004, 0, 'liquid'],

  ['tnt',        'Тротил (ТНТ)',               'TNT',                    [226,206,120],    1.65,  0.3,  0.1,  1.0, 0.30,  30, 0.05,    0, 290, 0, 19, 'explosive'],
  ['rdx',        'Гексоген / Comp B',          'RDX / Comp B',           [240,236,220],    1.72,  0.3,  0.1,  1.0, 0.30,  30, 0.05,    0, 230, 0, 28, 'explosive'],
  ['pe4',        'Пластит (ПВВ)',              'Plastic explosive',      [232,230,200],    1.60,  0.2,  0.05, 0.5, 0.00,  30, 0.05,    0, 260, 0, 24, 'explosive'],
  ['era',        'ВВ динамической защиты',     'ERA explosive',          [190,170,90],     1.50,  0.3,  0.1,  1.0, 0.20,  30, 0.05,    0, 260, 0, 18, 'explosive'],
  ['propellant', 'Метательный заряд (порох)',  'Propellant charge',      [150,138,74],     1.60,  0.3,  0.1,  1.0, 0.30,  30, 0.05,    0, 200, 0, 5, 'explosive'],
  ['gunpowder',  'Порох (насыпью)',            'Gunpowder (loose)',      [60,58,56],       1.70,  0.05, 0.02, 1.0, 0.00,  15, 0.01,    0, 180, 0, 4, 'explosive'],

  ['bedrock',    'Неразрушимое',               'Indestructible',         [40,40,46],      99.0,   1e9,  1e9, 10.0, 0.00, 1e9, 1e9,     0, 0, 0, 0, 'special'],
  ['stalinium',  'Сталиниум',                  'Stalinium',              [180,30,30],      7.90, 14.0,  6.0,  9.0, 0.05, 400, 6.00,    0, 0, 0, 0, 'special'],

  // particle-only materials (not paintable)
  ['fire',       'Огонь',                      'Fire',                   [255,140,30],     0.001, 0,    0,    0,   0,     1,  1,       0, 0, 0, 0, 'fx'],
  ['smoke',      'Дым',                        'Smoke',                  [90,90,96],       0.001, 0,    0,    0,   0,     1,  1,       0, 0, 0, 0, 'fx'],
];

const POWDERS = new Set(['sand', 'gunpowder']);
const LIQUIDS = new Set(['water', 'diesel', 'napalm']);
const GASES = new Set(['fire', 'smoke']);
const LOW_EXPLOSIVES = new Set(['propellant', 'gunpowder']);
const PYRO = new Set(['du']); // pyrophoric – fragments ignite
const SENS = { tnt: 6, rdx: 5, pe4: 8, era: 2.5, propellant: 2.0, gunpowder: 1.5 };

export const MATERIALS = [null]; // index 0 = empty
export const MAT = {};           // key -> id

RAW.forEach((r, i) => {
  const [key, ru, en, color, density, R, Y, hard, brittle, atten, spall, melt, ignite, burn, P0, cat] = r;
  const m = {
    id: i + 1, key, name: { ru, en }, color, density, R, Y, hard, brittle, atten, spall,
    melt, ignite, burn, P0, cat,
    low: LOW_EXPLOSIVES.has(key),
    pyro: PYRO.has(key),
    sens: SENS[key] || 0,
    state: POWDERS.has(key) ? STATE.POWDER : LIQUIDS.has(key) ? STATE.LIQUID : GASES.has(key) ? STATE.GAS : STATE.SOLID,
    flammable: ignite > 0 && P0 === 0,
    paintable: cat !== 'fx',
  };
  MATERIALS.push(m);
  MAT[key] = m.id;
});

// keep pristine copies so the material editor can reset values
export const DEFAULTS = MATERIALS.map(m => (m ? { ...m, color: [...m.color] } : null));

export function resetMaterial(id) {
  const d = DEFAULTS[id];
  Object.assign(MATERIALS[id], { ...d, color: [...d.color] });
}

export const CATEGORIES = [
  ['metal', 'Металлы', 'Metals'],
  ['ceramic', 'Керамика и стекло', 'Ceramics & glass'],
  ['mineral', 'Камень и бетон', 'Stone & concrete'],
  ['organic', 'Органика', 'Organics'],
  ['liquid', 'Жидкости', 'Liquids'],
  ['explosive', 'Взрывчатка', 'Explosives'],
  ['special', 'Особые', 'Special'],
];
