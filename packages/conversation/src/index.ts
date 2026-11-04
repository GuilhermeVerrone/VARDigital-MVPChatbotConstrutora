export * from './types';
export { T, CONSENT_TEXT_VERSION, brl, formatPhone } from './templates';
export { STEPS, isAnswerState, summaryLines, correctionOptions, resolveCorrectionTarget, resultOptions } from './steps';
export {
  MAX_FAILURES, applyInterpretation, enterResult, failSimulation, handleNonText, initialSnapshot, interpretStep, questionFor, replyPreview, resumeAfterHandoff, withResume,
  type ResultArgs, type TurnMeta,
} from './machine';
