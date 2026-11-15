// Уровни, тексты, достижения. Все строки игры на русском.
// layout: maze — лабиринт, halls — залы с колоннами, rooms — комнаты с проходами,
//         parking — открытая парковка, shelves — склад со стеллажами, pool — бассейны.

const THEMES = [
  {
    id: 0, name: 'Жёлтые комнаты', tip: 'Найди дверь с зелёной табличкой «ВЫХОД».',
    layout: 'maze', n: 10, open: 0.34, rooms: 4, h: 2.7, secret: 'love', grime: 0.3,
    wall: 'wallpaper', floor: 'carpet', ceil: 'tiles',
    wallCol: [214, 202, 128], floorCol: [146, 132, 86], ceilCol: [224, 218, 192],
    fog: 0x2e2a12, fogD: 0.05, lampCol: [1.0, 0.92, 0.7], lampI: 1,
    dead: 0.08, power: 1.0, black: 0.5, needKey: false, lockers: 0,
    water: 4, batt: 2, props: null, spawn: 45, entSpeed: 1.0, step: 'carpet'
  },
  {
    id: 1, name: 'Гудящие коридоры', tip: 'Свет еле держится. В шкафчиках можно спрятаться.',
    layout: 'maze', n: 11, open: 0.14, rooms: 2, h: 2.7,
    wall: 'concrete', floor: 'concrete', ceil: 'concrete',
    wallCol: [150, 148, 140], floorCol: [118, 116, 110], ceilCol: [126, 124, 118],
    fog: 0x111210, fogD: 0.08, lampCol: [0.86, 0.93, 1.0], lampI: 1,
    dead: 0.2, power: 0.9, black: 1.0, needKey: true, lockers: 3,
    water: 4, batt: 3, props: 'pipes', spawn: 38, entSpeed: 1.05, step: 'concrete'
  },
  {
    id: 2, name: 'Парковка', tip: 'Пустые машины. Пустые места. Кто-то оставил радио включённым.',
    layout: 'parking', n: 11, h: 2.6,
    wall: 'concrete', floor: 'parking', ceil: 'concrete',
    wallCol: [140, 140, 136], floorCol: [92, 92, 90], ceilCol: [110, 110, 106],
    fog: 0x0c0d0e, fogD: 0.075, lampCol: [0.82, 0.92, 1.0], lampI: 1.1,
    dead: 0.3, power: 0.85, black: 1.2, needKey: true, lockers: 2,
    water: 4, batt: 3, props: 'cars', spawn: 32, entSpeed: 1.1, step: 'concrete'
  },
  {
    id: 3, name: 'Улыбки', tip: 'Кто-то нарисовал улыбки на каждой стене. Бассейн с шариками замедляет шаг.',
    layout: 'smiles', n: 11, pillars: 0.1, h: 3.0, secret: 'smile',
    wall: 'smiles', floor: 'playmat', ceil: 'tiles',
    wallCol: [246, 226, 120], floorCol: [200, 200, 200], ceilCol: [236, 230, 206],
    fog: 0x2e2610, fogD: 0.06, lampCol: [1.0, 0.95, 0.8], lampI: 1.15,
    dead: 0.06, power: 1.0, black: 0.8, needKey: true, lockers: 2,
    water: 4, batt: 2, props: 'smiles', spawn: 30, entSpeed: 1.1, step: 'foam'
  },
  {
    id: 4, name: 'Сырые залы', tip: 'Пей воду, когда в голове шумит громче ламп.',
    layout: 'halls', n: 12, pillars: 0.28, h: 3.0,
    wall: 'damp', floor: 'wetcarpet', ceil: 'tiles',
    wallCol: [146, 156, 96], floorCol: [88, 96, 58], ceilCol: [178, 182, 152],
    fog: 0x0b1206, fogD: 0.085, lampCol: [0.9, 1.0, 0.76], lampI: 1.1,
    dead: 0.24, power: 0.82, black: 1.3, needKey: true, lockers: 3,
    water: 5, batt: 3, props: 'puddles', spawn: 28, entSpeed: 1.14, step: 'wet'
  },
  {
    id: 5, name: 'Бассейны', tip: 'Здесь светло и тихо. Вода замедляет шаг и громко плещет.',
    layout: 'pool', n: 11, pillars: 0.14, h: 3.2,
    wall: 'tiles', floor: 'pooltiles', ceil: 'tiles',
    wallCol: [226, 234, 236], floorCol: [214, 224, 226], ceilCol: [232, 238, 240],
    fog: 0x8fb7bd, fogD: 0.055, lampCol: [0.95, 1.0, 1.0], lampI: 1.2,
    dead: 0.05, power: 1.05, black: 0.6, needKey: true, lockers: 0,
    water: 3, batt: 2, props: 'pool', spawn: 30, entSpeed: 1.15, step: 'tile'
  },
  {
    id: 6, name: 'Пиксельный цирк', tip: 'Шатёр без края. Музыка не замолкает. За стенами только сетка пикселей.',
    layout: 'circus', n: 12, h: 4.4, secret: 'circus', noCeil: true,
    wall: 'circus', floor: 'checker', ceil: 'tent',
    wallCol: [200, 30, 40], floorCol: [230, 226, 214], ceilCol: [190, 30, 44],
    fog: 0x12051c, fogD: 0.06, lampCol: [1.0, 0.86, 0.68], lampI: 2.0,
    dead: 0.1, power: 0.95, black: 1.0, needKey: true, lockers: 2,
    water: 4, batt: 3, props: 'circus', spawn: 26, entSpeed: 1.17, step: 'tile'
  },
  {
    id: 7, name: 'Тихий офис', tip: 'Не бегай. Шаги здесь слышно далеко.',
    layout: 'rooms', n: 12, h: 2.7,
    wall: 'office', floor: 'office', ceil: 'tiles',
    wallCol: [208, 206, 194], floorCol: [80, 90, 112], ceilCol: [226, 226, 220],
    fog: 0x0f1117, fogD: 0.075, lampCol: [0.93, 0.97, 1.0], lampI: 1,
    dead: 0.15, power: 0.94, black: 1.4, needKey: true, lockers: 4,
    water: 4, batt: 3, props: 'office', spawn: 22, entSpeed: 1.2, step: 'carpet'
  },
  {
    id: 8, name: 'Склад', tip: 'Стеллажи до потолка. Слушай сердце, прежде чем свернуть.',
    layout: 'shelves', n: 12, h: 5.2,
    wall: 'concrete', floor: 'concrete', ceil: 'concrete',
    wallCol: [132, 130, 124], floorCol: [128, 126, 120], ceilCol: [70, 70, 68],
    fog: 0x0d0c0a, fogD: 0.07, lampCol: [1.0, 0.94, 0.8], lampI: 3.2,
    dead: 0.25, power: 0.85, black: 1.6, needKey: true, lockers: 3,
    water: 4, batt: 4, props: 'shelves', spawn: 20, entSpeed: 1.24, step: 'concrete'
  },
  {
    id: 9, name: 'Мёртвый свет', tip: 'Береги фонарик. Темнота здесь живая.',
    layout: 'maze', n: 13, open: 0.3, rooms: 4, h: 2.7,
    wall: 'dark', floor: 'carpet', ceil: 'tiles',
    wallCol: [152, 106, 64], floorCol: [88, 54, 36], ceilCol: [150, 130, 110],
    fog: 0x070302, fogD: 0.11, lampCol: [1.0, 0.62, 0.45], lampI: 1,
    dead: 0.5, power: 0.6, black: 2.2, needKey: true, lockers: 4,
    water: 4, batt: 5, props: 'emergency', spawn: 15, entSpeed: 1.3, step: 'carpet'
  }
];
const LAST = THEMES.length - 1;

function theme(level) {
  if (level < THEMES.length) return THEMES[level];
  const b = THEMES[level % THEMES.length];
  const deep = level - THEMES.length;
  return Object.assign({}, b, {
    id: level, name: 'Глубже · ' + level, tip: 'Отсюда ещё никто не возвращался.',
    n: Math.min(b.n + 1 + deep, 18), dead: Math.min(0.6, b.dead + 0.12), power: Math.max(0.5, b.power * 0.85),
    black: b.black + 0.6, spawn: Math.max(10, b.spawn - 8), entSpeed: b.entSpeed + 0.1 + deep * 0.04,
    water: 3, batt: 3, needKey: true, lockers: Math.max(2, b.lockers)
  });
}

const DIFF = {
  easy: { name: 'Лёгкая', speed: 0.8, drain: 0.65, items: 1.35, spawn: 1.5 },
  normal: { name: 'Обычная', speed: 1, drain: 1, items: 1, spawn: 1 },
  nightmare: { name: 'Кошмар', speed: 1.2, drain: 1.35, items: 0.75, spawn: 0.65 }
};

// id записки не меняются между версиями: сохранения остаются верными.
const NOTES = [
  { t: 'Записка №1', lv: 0, b: 'Если ты это читаешь, значит, ты тоже провалился. Не паникуй. Здесь всегда горит свет и всегда гудит. Ищи зелёную табличку «ВЫХОД». Двери есть, просто их очень мало.' },
  { t: 'Записка №2', lv: 0, b: 'Я видел его в конце коридора. Высокий, худой, руки почти до колен. Пока я смотрел на него, он стоял. Стоило отвернуться, и он оказался ближе. Не поворачивайся к нему спиной.' },
  { t: 'Записка №3', lv: 1, b: 'Здесь бетон и трубы. Двери заперты электронными замками. Ключ-карты остались от тех, кто был тут до нас. Без карты к выходу можно не идти.' },
  { t: 'Записка №4', lv: 1, b: 'Когда бежишь, он слышит. Шаги по бетону разносятся далеко. Хочешь остаться один, иди медленно.' },
  { t: 'Записка №5', lv: 4, b: 'Вода в бутылках чистая. Пей её, когда в голове гудит громче, чем лампы. Без воды начинаешь забывать собственное имя.' },
  { t: 'Записка №6', lv: 4, b: 'Сегодня я считал капли. Три тысячи сто двенадцать. Потом капли начали считать меня.' },
  { t: 'Записка №7', lv: 7, b: 'Здесь кто-то работал. На всех мониторах одна строчка: «ВЫ ОСТАЁТЕСЬ НА СВЯЗИ». Кресла до сих пор тёплые.' },
  { t: 'Записка №8', lv: 7, b: 'Старик у кулера сказал: на самом первом уровне есть стена, которая помнит чьё-то имя. Ищи маленькое красное сердце у самого пола. Не стучи. Просто иди сквозь неё.' },
  { t: 'Записка №9', lv: 9, b: 'Половина ламп мертва. В темноте он быстрее. Береги батарейки: без фонарика здесь не выжить.' },
  { t: 'Записка №10', lv: 9, b: 'Я вижу дверь. Зелёный свет. Если это моя последняя записка, значит, я либо вышел, либо стал частью стен. Не оглядывайся.' },
  { t: 'Записка №11', lv: 2, b: 'Машины здесь пустые, но капоты тёплые. В одной играло радио. Я выключил его, и где-то далеко его включили снова.' },
  { t: 'Записка №12', lv: 2, b: 'Если он рядом, прячься в шкафчик у стены. Там он тебя не видит. Только не залезай туда у него на глазах: он запомнит.' },
  { t: 'Записка №13', lv: 5, b: 'Здесь светло и тихо, пахнет хлоркой. Это место хочет, чтобы ты остался. Не оставайся.' },
  { t: 'Записка №14', lv: 5, b: 'Вода тёплая, по пояс. В ней идёшь медленно, а плеск слышно далеко. Если слышишь всплески, которых ты не делал, выбирайся на сухой пол.' },
  { t: 'Записка №15', lv: 8, b: 'Стеллажи до самого потолка. На каждой коробке написано моё имя. Я не открывал ни одной.' },
  { t: 'Записка №16', lv: 8, b: 'Между рядами он ходит бесшумно. Слушай сердце. Если застучало, сверни в другой проход.' },
  { t: 'Записка №17', lv: 3, b: 'Кто-то нарисовал улыбки на каждой стене. Сотни. Тысячи. И все смотрят туда, где я стою.' },
  { t: 'Записка №18', lv: 3, b: 'Среди всех этих улыбок есть одно сердечко у самого пола, на краю. Оно не нарисовано, оно ждёт. Пройди сквозь стену.' },
  { t: 'Записка №19', lv: 6, b: 'Здесь всегда играет шарманка. Шатёр бесконечный, а за его краем ничего нет, только сетка из пикселей.' },
  { t: 'Записка №20', lv: 6, b: 'Одна полосатая стена тёплая на ощупь. У самого пола на ней сердце. Говорят, за ней кто-то оставил подарок.' }
];
const notesFor = (lv) => NOTES.map((n, i) => (n.lv === lv ? i : -1)).filter((i) => i >= 0);

const ACH = [
  { id: 'first', ic: '🚪', name: 'Первый шаг', d: 'Выбраться с уровня 0' },
  { id: 'calm', ic: '🧘', name: 'Без паники', d: 'Пройти уровень, не опустив рассудок ниже 50%' },
  { id: 'stare', ic: '👁️', name: 'Гляделки', d: 'Смотреть на Него 5 секунд подряд' },
  { id: 'hide', ic: '🚪', name: 'Невидимка', d: 'Переждать Его в шкафчике, когда Оно совсем рядом' },
  { id: 'swim', ic: '🏊', name: 'Купальщик', d: 'Пройти Бассейны' },
  { id: 'clown', ic: '🎪', name: 'Финальный номер', d: 'Пройти Пиксельный цирк' },
  { id: 'archive', ic: '📜', name: 'Архивариус', d: 'Собрать все 20 записок' },
  { id: 'friend', ic: '🤝', name: 'Не один', d: 'Пройти уровень вместе с другом онлайн' },
  { id: 'escape', ic: '🌤️', name: 'Свет в конце', d: 'Пройти уровень 9 и выбраться' },
  { id: 'deep', ic: '🕳️', name: 'Глубже некуда', d: 'Добраться до уровня 12' },
  { id: 'anom', ic: '👁', name: 'Исследователь', d: 'Найти все 8 аномалий' },
  { id: 'emp', ic: '⚡', name: 'Короткое замыкание', d: 'Оглушить Его импульсом ЭМИ' },
  { id: 'run', ic: '🏃', name: 'Ноги в руки', d: 'Пережить погоню и выбраться' },
  { id: 'secret', ic: '❤️', name: 'Тайная комната', d: 'Найти то, что помнит стена', hidden: true },
  { id: 'secret2', ic: '💛', name: 'Самая тёплая улыбка', d: 'Найти сердце среди улыбок', hidden: true },
  { id: 'secret3', ic: '🎈', name: 'Подарок под куполом', d: 'Найти тайный шатёр в цирке', hidden: true }
];

const PROLOGUE = [
  'Обычный вечер. Ты просто шёл домой.',
  'На секунду пол под ногой исчез.',
  'Ты провалился сквозь реальность.',
  'Теперь вокруг только гул ламп.'
];

const ENDING = [
  'Дверь поддалась.',
  'Холодный воздух. Шум машин. Над головой небо.',
  'Ты выбрался.',
  '…или Закулисье просто отпустило тебя ненадолго?'
];

const WHISPERS = [
  'ты здесь не один', 'не оборачивайся', 'выхода нет', 'оно слышит шаги', 'сколько ты уже здесь?',
  'лампы гудят громче', 'ты уже был в этой комнате', 'кто-то шёл здесь до тебя', 'не останавливайся',
  'стены снова те же', 'оно ближе, чем кажется', 'ты помнишь своё имя?'
];

// Тайные комнаты: тема → уровень, достижение, надпись
const SECRETS = {
  love: { ach: 'secret', title: 'ТАЙНАЯ КОМНАТА', ic: '❤' },
  smile: { ach: 'secret2', title: 'САМАЯ ТЁПЛАЯ УЛЫБКА', ic: '💛' },
  circus: { ach: 'secret3', title: 'ПОДАРОК ПОД КУПОЛОМ', ic: '🎈' }
};
const QUICK = ['Сюда!', 'Беги!', 'Оно рядом!', 'Нашёл ключ', 'Я в шкафчике', 'Жди меня', 'Помоги!', '❤️'];

// Монстры: у каждого уровня свой. look — внешность, ai — особенность поведения.
const MONSTERS = {
  watcher: { name: 'Наблюдатель', ic: '👁', trait: 'Пока ты смотришь на него, он стоит. Отвернёшься — подойдёт.',
    look: { kind: 'watcher', skin: [58, 50, 44], eyes: 'blank', mouth: 'none', posture: 'hunch', height: 1.18, thin: 0.85 }, ai: { stare: 0.12 } },
  blind: { name: 'Слепой', ic: '🦻', trait: 'Он не видит, но слышит каждый шаг. Замри — и он пройдёт мимо.',
    look: { kind: 'blind', skin: [140, 138, 132], eyes: 'none', mouth: 'jaw', posture: 'hunch', height: 1.05 }, ai: { blind: true, hear: 2.6, stare: 1 } },
  crawler: { name: 'Ползун', ic: '🕷', trait: 'Ползает на четвереньках и несётся по прямой. Сворачивай за углы.',
    look: { kind: 'crawler', skin: [120, 112, 106], eyes: 'glow', mouth: 'grin', posture: 'crawl' }, ai: { straight: 1.7, turn: 0.45, stare: 0.6 } },
  grinner: { name: 'Улыбака', ic: '😁', trait: 'Не ходит, а перескакивает ближе, стоит тебе отвернуться. Не своди с него глаз.',
    look: { kind: 'grinner', skin: [40, 36, 40], eyes: 'blank', mouth: 'none', posture: 'stand', height: 1.12, thin: 0.8 }, ai: { blink: true, stare: 0 } },
  drowned: { name: 'Утопленник', ic: '💧', trait: 'Медленный и мокрый. Рядом с ним рассудок тает втрое быстрее.',
    look: { kind: 'drowned', skin: [104, 128, 116], wet: true, eyes: 'hollow', mouth: 'jaw', posture: 'hunch' }, ai: { speed: 0.75, drain: 3, stare: 0.4 } },
  swimmer: { name: 'Пловец', ic: '🌊', trait: 'В воде вдвое быстрее, на сухом полу медленный. Держись подальше от бассейнов.',
    look: { kind: 'swimmer', skin: [184, 198, 204], wet: true, eyes: 'glow', mouth: 'jaw', posture: 'hunch', thin: 0.85 }, ai: { water: 2.1, dry: 0.6, stare: 0.5 } },
  puppet: { name: 'Марионетка', ic: '🎭', trait: 'Пока играет шарманка, она стоит. Музыка стихла — беги.',
    look: { kind: 'puppet', skin: [232, 222, 206], puppet: true, eyes: 'painted', mouth: 'painted', posture: 'stand' }, ai: { music: true, stare: 1 } },
  mimic: { name: 'Двойник', ic: '👣', trait: 'Повторяет твои шаги. Ты стоишь, а шаги всё ещё слышны? Он рядом.',
    look: { kind: 'mimic', skin: [70, 72, 80], eyes: 'blank', mouth: 'none', posture: 'stand', suit: true }, ai: { mimic: true, stare: 0.5 } },
  stalker: { name: 'Охотник', ic: '🔦', trait: 'Очень быстрый и видит издалека, но боится света: луч фонарика заставляет его отступить.',
    look: { kind: 'stalker', skin: [92, 78, 72], height: 1.22, eyes: 'many', mouth: 'jaw', posture: 'hunch' }, ai: { fast: 1.25, fear: true, stare: 1 } },
  shadow: { name: 'Тень', ic: '🌑', trait: 'Живёт в темноте. На свету медленная и почти невидимая, в темноте молниеносная.',
    look: { kind: 'shadow', shadow: true, eyes: 'glow', mouth: 'none', posture: 'stand', height: 1.1 }, ai: { shadow: true, stare: 0.5 } }
};
const MONSTER_BY_LEVEL = ['watcher', 'blind', 'crawler', 'grinner', 'drowned', 'swimmer', 'puppet', 'mimic', 'stalker', 'shadow'];
const monsterFor = (lv) => MONSTERS[MONSTER_BY_LEVEL[lv % MONSTER_BY_LEVEL.length]];

export { THEMES, LAST, theme, DIFF, NOTES, notesFor, ACH, PROLOGUE, ENDING, WHISPERS, SECRETS, QUICK, MONSTERS, MONSTER_BY_LEVEL, monsterFor };
