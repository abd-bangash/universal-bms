/**
 * Synthetic furniture conversations with the answer a careful person would write down
 * (Requirement 43.16). They are the evaluation set for the AI extraction, and ten of them are loaded
 * into the demo business so the AI screens have something to read.
 *
 * `expected` is the truth: what the customer actually said. `recorded` is what the fake adapter
 * replays in place of a model, so CI exercises everything downstream of the model (grounding,
 * mapping, scoring) with no network. A few recordings are wrong on purpose, as a model sometimes is:
 * an invented colour (which grounding must catch) and a wrong product (which counts against accuracy).
 */
export interface EvalMessage {
  from: 'CUSTOMER' | 'STAFF';
  text: string;
  /** The message is a photo sent with `text` as its caption. */
  image?: boolean;
}

export interface EvalConversation {
  id: string;
  title: string;
  contactName: string;
  contactPhone: string;
  messages: EvalMessage[];
  expected: {
    fields: Record<string, string>;
    /** The code of the product the customer means; leave out when no product can be named. */
    product?: string;
  };
  recorded: {
    fields: Array<{ key: string; value: string; confidence: number }>;
    productCodes: string[];
  };
}

const c = (text: string, image = false): EvalMessage => ({
  from: 'CUSTOMER',
  text,
  ...(image ? { image } : {}),
});
const s = (text: string): EvalMessage => ({ from: 'STAFF', text });
const f = (key: string, value: string, confidence = 0.9) => ({ key, value, confidence });

export const EVAL_CONVERSATIONS: readonly EvalConversation[] = [
  {
    id: 'eval-01',
    title: 'L-shaped leather sofa from a picture',
    contactName: 'Sana Malik',
    contactPhone: '923001000001',
    messages: [
      c('Hi, I want one L-shaped sofa, about 8 feet, in brown leather'),
      c('same design as this picture', true),
    ],
    expected: {
      fields: {
        interest: 'L-shaped sofa',
        quantity: '1',
        length: '8 feet',
        material: 'leather',
        color: 'brown',
        design: 'same design as this picture',
        reference_image: 'image attached',
      },
      product: 'SOF-001',
    },
    recorded: {
      fields: [
        f('interest', 'L-shaped sofa'),
        f('quantity', '1'),
        f('length', '8 feet'),
        f('material', 'leather'),
        f('color', 'brown'),
        f('design', 'same design as this picture'),
        f('reference_image', 'image attached'),
      ],
      productCodes: ['SOF-001'],
    },
  },
  {
    id: 'eval-02',
    title: 'Marble dining table for six',
    contactName: 'Bilal Ahmed',
    contactPhone: '923001000002',
    messages: [
      c('Need a marble dining table for 6 people, around 5 feet long. What is the price?'),
    ],
    expected: {
      fields: { interest: 'marble dining table', material: 'marble', length: '5 feet' },
      product: 'TAB-001',
    },
    recorded: {
      fields: [
        f('interest', 'marble dining table'),
        f('material', 'marble'),
        f('length', '5 feet'),
      ],
      productCodes: ['TAB-001'],
    },
  },
  {
    id: 'eval-03',
    title: 'Four executive chairs',
    contactName: 'Hira Shah',
    contactPhone: '923001000003',
    messages: [
      c('Do you have executive chairs?'),
      s('Yes we do, how many do you need?'),
      c('I need 4 for my office, black color'),
    ],
    expected: {
      fields: { interest: 'executive chairs', quantity: '4', color: 'black' },
      product: 'CHR-003',
    },
    recorded: {
      fields: [f('interest', 'executive chairs'), f('quantity', '4'), f('color', 'black')],
      productCodes: ['CHR-003'],
    },
  },
  {
    id: 'eval-04',
    title: 'King bed in sheesham',
    contactName: 'Usman Tariq',
    contactPhone: '923001000004',
    messages: [c('I want a king size bed made of sheesham wood, width 6 feet, length 6.5 feet')],
    expected: {
      fields: {
        interest: 'king size bed',
        wood_type: 'sheesham',
        width: '6 feet',
        length: '6.5 feet',
      },
      product: 'BED-001',
    },
    recorded: {
      fields: [
        f('interest', 'king size bed'),
        f('wood_type', 'sheesham'),
        f('width', '6 feet'),
        f('length', '6.5 feet'),
      ],
      productCodes: ['BED-001'],
    },
  },
  {
    id: 'eval-05',
    title: 'Sliding wardrobe, Roman Urdu',
    contactName: 'Zainab Raza',
    contactPhone: '923001000005',
    messages: [c('Assalam o alaikum, almari chahiye 3 door wali sliding, budget 130000')],
    expected: {
      fields: { interest: 'almari 3 door sliding', budget: '130000' },
      product: 'STO-001',
    },
    recorded: {
      fields: [f('interest', 'almari 3 door sliding'), f('budget', '130000')],
      productCodes: ['STO-001'],
    },
  },
  {
    id: 'eval-06',
    title: 'Bunk bed for the kids',
    contactName: 'Farah Jabeen',
    contactPhone: '923001000006',
    messages: [c('I need a bunk bed for my kids, blue color, in wood')],
    expected: {
      fields: { interest: 'bunk bed', color: 'blue', material: 'wood' },
      product: 'BED-003',
    },
    recorded: {
      fields: [f('interest', 'bunk bed'), f('color', 'blue'), f('material', 'wood')],
      productCodes: ['BED-003'],
    },
  },
  {
    id: 'eval-07',
    title: 'TV unit, 180 cm',
    contactName: 'Kamran Butt',
    contactPhone: '923001000007',
    messages: [c('TV unit chahiye, 180 cm wide, walnut color')],
    expected: {
      fields: { interest: 'TV unit', width: '180 cm', color: 'walnut' },
      product: 'STO-005',
    },
    recorded: {
      fields: [f('interest', 'TV unit'), f('width', '180 cm'), f('color', 'walnut')],
      productCodes: ['STO-005'],
    },
  },
  {
    id: 'eval-08',
    title: 'Two orthopedic mattresses',
    contactName: 'Maryam Khan',
    contactPhone: '923001000008',
    messages: [c('queen size orthopedic mattress, 2 pieces please')],
    expected: {
      fields: { interest: 'queen size orthopedic mattress', quantity: '2' },
      product: 'BED-005',
    },
    recorded: {
      fields: [f('interest', 'queen size orthopedic mattress'), f('quantity', '2')],
      productCodes: ['BED-005'],
    },
  },
  {
    id: 'eval-09',
    title: 'Round marble centre table',
    contactName: 'Adeel Nawaz',
    contactPhone: '923001000009',
    messages: [c('Looking for a round marble centre table for the lounge')],
    expected: {
      fields: { interest: 'round marble centre table', material: 'marble' },
      product: 'TAB-004',
    },
    recorded: {
      fields: [f('interest', 'round marble centre table'), f('material', 'marble')],
      productCodes: ['TAB-004'],
    },
  },
  {
    id: 'eval-10',
    title: 'Custom corner sofa with measurements',
    contactName: 'Rabia Siddiqui',
    contactPhone: '923001000010',
    messages: [
      c('Custom corner sofa, 9 ft x 6 ft, grey fabric, custom size'),
      c('like this one', true),
    ],
    expected: {
      fields: {
        interest: 'custom corner sofa',
        length: '9 ft',
        width: '6 ft',
        material: 'fabric',
        color: 'grey',
        size_type: 'custom',
        reference_image: 'image attached',
      },
      product: 'SOF-001',
    },
    recorded: {
      fields: [
        f('interest', 'custom corner sofa'),
        f('length', '9 ft'),
        f('width', '6 ft'),
        f('material', 'fabric'),
        f('color', 'grey'),
        f('size_type', 'custom'),
        f('reference_image', 'image attached'),
      ],
      productCodes: ['SOF-001'],
    },
  },
  {
    id: 'eval-11',
    title: 'Six velvet dining chairs',
    contactName: 'Nida Hassan',
    contactPhone: '923001000011',
    messages: [c('6 velvet dining chairs in green please')],
    expected: {
      fields: { interest: 'velvet dining chairs', quantity: '6', color: 'green' },
      product: 'CHR-002',
    },
    recorded: {
      fields: [f('interest', 'velvet dining chairs'), f('quantity', '6'), f('color', 'green')],
      productCodes: ['CHR-002'],
    },
  },
  {
    id: 'eval-12',
    title: 'Study table for a son',
    contactName: 'Imran Qureshi',
    contactPhone: '923001000012',
    messages: [c('I need a study table for my son, computer table with drawers, brown')],
    expected: { fields: { interest: 'study table', color: 'brown' }, product: 'OFF-003' },
    recorded: {
      fields: [f('interest', 'study table'), f('color', 'brown')],
      productCodes: ['OFF-003'],
    },
  },
  {
    id: 'eval-13',
    title: 'Electric standing desk',
    contactName: 'Sadia Anwar',
    contactPhone: '923001000013',
    messages: [c('electric standing desk, white, 1 piece')],
    expected: {
      fields: { interest: 'electric standing desk', color: 'white', quantity: '1' },
      product: 'OFF-002',
    },
    recorded: {
      fields: [f('interest', 'electric standing desk'), f('color', 'white'), f('quantity', '1')],
      productCodes: ['OFF-002'],
    },
  },
  {
    id: 'eval-14',
    title: 'Only asks the shop hours',
    contactName: 'Asad Mehmood',
    contactPhone: '923001000014',
    messages: [c('Hello'), c('Assalam o alaikum, aap ka shop kab khulta hai?')],
    expected: { fields: {} },
    recorded: { fields: [], productCodes: [] },
  },
  {
    id: 'eval-15',
    title: 'Price of a named bed',
    contactName: 'Tahira Begum',
    contactPhone: '923001000015',
    messages: [c("What's the price of the Heritage King Bed?")],
    expected: { fields: { interest: 'Heritage King Bed' }, product: 'BED-001' },
    recorded: { fields: [f('interest', 'Heritage King Bed')], productCodes: ['BED-001'] },
  },
  {
    id: 'eval-16',
    title: 'Teak bookcase, seven feet tall',
    contactName: 'Waqar Ali',
    contactPhone: '923001000016',
    messages: [c('5 tier bookcase in teak, 7 feet tall')],
    expected: {
      fields: { interest: '5 tier bookcase', wood_type: 'teak', height: '7 feet' },
      product: 'STO-004',
    },
    recorded: {
      fields: [f('interest', '5 tier bookcase'), f('wood_type', 'teak'), f('height', '7 feet')],
      productCodes: ['STO-004'],
    },
  },
  {
    id: 'eval-17',
    title: 'Two black leather recliners',
    contactName: 'Saira Nadeem',
    contactPhone: '923001000017',
    messages: [c('Two recliners in black leather')],
    expected: {
      fields: { interest: 'recliners', quantity: '2', color: 'black', material: 'leather' },
      product: 'SOF-004',
    },
    recorded: {
      fields: [
        f('interest', 'recliners'),
        f('quantity', '2'),
        f('color', 'black'),
        f('material', 'leather'),
      ],
      productCodes: ['SOF-004'],
    },
  },
  {
    id: 'eval-18',
    title: 'Four-door shoe rack',
    contactName: 'Hamza Yousaf',
    contactPhone: '923001000018',
    messages: [c('shoe rack 4 door, beige')],
    expected: { fields: { interest: 'shoe rack', color: 'beige' }, product: 'STO-006' },
    recorded: {
      fields: [f('interest', 'shoe rack'), f('color', 'beige')],
      productCodes: ['STO-006'],
    },
  },
  {
    id: 'eval-19',
    title: 'A sofa, nothing more (the model invents details)',
    contactName: 'Kiran Zahid',
    contactPhone: '923001000019',
    messages: [c('I want a sofa')],
    expected: { fields: { interest: 'sofa' } },
    // the model also "remembers" a colour and a material nobody mentioned: grounding must catch both
    recorded: {
      fields: [f('interest', 'sofa'), f('color', 'red', 0.95), f('material', 'leather', 0.9)],
      productCodes: [],
    },
  },
  {
    id: 'eval-20',
    title: 'Wing chair (the model picks the wrong product)',
    contactName: 'Mubashir Rao',
    contactPhone: '923001000020',
    messages: [c('wing chair for my bedroom, grey')],
    expected: { fields: { interest: 'wing chair', color: 'grey' }, product: 'CHR-005' },
    recorded: {
      fields: [f('interest', 'wing chair'), f('color', 'grey')],
      productCodes: ['CHR-001'],
    },
  },
  {
    id: 'eval-21',
    title: 'Eight-seater teak table',
    contactName: 'Shazia Perveen',
    contactPhone: '923001000021',
    messages: [c('8 seater wooden dining table in teak, 8 feet long')],
    expected: {
      fields: { interest: '8 seater wooden dining table', wood_type: 'teak', length: '8 feet' },
      product: 'TAB-002',
    },
    recorded: {
      fields: [
        f('interest', '8 seater wooden dining table'),
        f('wood_type', 'teak'),
        f('length', '8 feet'),
      ],
      productCodes: ['TAB-002'],
    },
  },
  {
    id: 'eval-22',
    title: 'Gives a name and an email, wants a side table',
    contactName: 'Ayesha Khan',
    contactPhone: '923001000022',
    messages: [
      c("Hi, I'm Ayesha Khan"),
      c('ayesha.khan@example.com'),
      c('looking for a side table in walnut'),
    ],
    expected: {
      fields: {
        fullName: 'Ayesha Khan',
        email: 'ayesha.khan@example.com',
        interest: 'side table',
        wood_type: 'walnut',
      },
      product: 'TAB-005',
    },
    recorded: {
      fields: [
        f('fullName', 'Ayesha Khan'),
        f('email', 'ayesha.khan@example.com'),
        f('interest', 'side table'),
        f('wood_type', 'walnut'),
      ],
      productCodes: ['TAB-005'],
    },
  },
];
