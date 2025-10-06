// src/lib/tax/index.ts
export * from './types';
export * from './utils';
//export * from './engine';

//nuevo no estaba
// Evita volver a exportar los tipos con el mismo nombre desde engine:
export { calculateTaxSnapshot } from './engine';

// Si también necesitas los tipos del engine, re-expórtalos con alias:
export type {
  TaxDraftInput as EngineTaxDraftInput,
  TaxSnapshot as EngineTaxSnapshot,
} from './engine';