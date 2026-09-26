// Single import point for the shared PIX templates. packages/shared has no
// `./templates` export yet (change request to A0); switch this line to
// `@bnbplay/shared/templates` once it lands.
export * from '../../../packages/shared/src/templates/index.ts';
