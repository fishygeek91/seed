/**
 * Closed ID vocabularies for the SEED simulator.
 *
 * Everything the sim can touch is named here. Keeping these unions closed
 * means the compiler catches a recipe that references a metal or a machine
 * that does not exist.
 */

/** Bulk element / feedstock bins tracked by the atoms ledger. */
export type ElementId = 'Fe' | 'Al' | 'Si' | 'C' | 'H2O' | 'other';

/** All element bins, in ledger display order. */
export const ELEMENT_IDS: readonly ElementId[] = ['Fe', 'Al', 'Si', 'C', 'H2O', 'other'];

/** Human labels for element bins. */
export const ELEMENT_LABELS: Record<ElementId, string> = {
  Fe: 'Iron / steel',
  Al: 'Aluminium',
  Si: 'Silicon / glass',
  C: 'Carbon / polymers',
  H2O: 'Water / ice',
  other: 'Other bulk',
};

/**
 * Vitamins: imported precision mass the seed cannot print yet.
 * Short, named, typed — not generic goo.
 */
export type VitaminId =
  | 'actuatorsBearings'
  | 'chipsPower'
  | 'sealsLubricants'
  | 'opticsSensors'
  | 'chemicals';

/** All vitamin bins, in ledger display order. */
export const VITAMIN_IDS: readonly VitaminId[] = [
  'actuatorsBearings',
  'chipsPower',
  'sealsLubricants',
  'opticsSensors',
  'chemicals',
];

/** Human labels for vitamin bins. */
export const VITAMIN_LABELS: Record<VitaminId, string> = {
  actuatorsBearings: 'Precision actuators / bearings',
  chipsPower: 'Chips / power electronics',
  sealsLubricants: 'Seals / lubricants',
  opticsSensors: 'Optics / sensors',
  chemicals: 'Chemicals / photoresists',
};

/** Robot chassis roles. Same chassis family, different toolheads. */
export type RobotTypeId = 'miner' | 'hauler' | 'assembler' | 'technician';

/** All robot roles. */
export const ROBOT_TYPE_IDS: readonly RobotTypeId[] = ['miner', 'hauler', 'assembler', 'technician'];

/** Labor / power allocation lanes. The task graph: mine → haul → process → print → assemble → QA, plus repair, recycle and process-dev. */
export type TaskId =
  | 'mine'
  | 'haul'
  | 'process'
  | 'print'
  | 'assemble'
  | 'qa'
  | 'repair'
  | 'recycle'
  | 'procdev';

/** All allocation lanes, in UI order. */
export const TASK_IDS: readonly TaskId[] = [
  'mine',
  'haul',
  'process',
  'print',
  'assemble',
  'qa',
  'repair',
  'recycle',
  'procdev',
];

/** Human labels for allocation lanes. */
export const TASK_LABELS: Record<TaskId, string> = {
  mine: 'Mine',
  haul: 'Haul',
  process: 'Process / refine',
  print: 'Print / sinter',
  assemble: 'Assemble',
  qa: 'Test / QA',
  repair: 'Repair',
  recycle: 'Recycle / remelt',
  procdev: 'Process dev',
};

/** Which robot roles can work which lanes. */
export const TASK_ELIGIBLE_ROBOTS: Record<TaskId, readonly RobotTypeId[]> = {
  mine: ['miner'],
  haul: ['hauler'],
  process: ['assembler', 'technician'],
  print: ['assembler'],
  assemble: ['assembler'],
  qa: ['technician'],
  repair: ['technician'],
  recycle: ['assembler', 'hauler'],
  procdev: ['technician', 'assembler'],
};

/** Every part the library can know how to make. */
export type PartId =
  | 'structuralFrame'
  | 'solarSection'
  | 'powerCable'
  | 'batteryPack'
  | 'actuator'
  | 'sensorComputeModule'
  | 'sealKit'
  | 'kilnPrinter'
  | 'machiningStation'
  | 'minerTool'
  | 'wheelset'
  | 'robotMiner'
  | 'robotHauler'
  | 'robotAssembler'
  | 'robotTechnician'
  | 'childSeedChassis';

/** All part ids, in library display order. */
export const PART_IDS: readonly PartId[] = [
  'structuralFrame',
  'solarSection',
  'powerCable',
  'batteryPack',
  'actuator',
  'sensorComputeModule',
  'sealKit',
  'kilnPrinter',
  'machiningStation',
  'minerTool',
  'wheelset',
  'robotMiner',
  'robotHauler',
  'robotAssembler',
  'robotTechnician',
  'childSeedChassis',
];

/** Machines that gate production throughput. A subset of parts becomes a deployed machine. */
export type MachineId = 'kilnPrinter' | 'machiningStation' | 'minerTool';

/** Sites the seed can land on. */
export type SiteId = 'earth' | 'mars';

/** Cargo manifest templates. */
export type TemplateId = 'balanced' | 'handsFirst' | 'powerFirst' | 'vitaminsFirst';

/** Robot part id for each role. */
export const ROBOT_PART_FOR_TYPE: Record<RobotTypeId, PartId> = {
  miner: 'robotMiner',
  hauler: 'robotHauler',
  assembler: 'robotAssembler',
  technician: 'robotTechnician',
};
