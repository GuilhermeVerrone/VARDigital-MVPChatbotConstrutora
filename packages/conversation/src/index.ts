export * from './types';
export { T, CONSENT_TEXT_VERSION, brl, formatPhone } from './templates';
export { DEFAULT_TEXTS, KNOWN_VARIABLES, TEXT_KEYS, firstContactText, stepOn, textVariables, tx, type TextKey, type TextVars } from './texts';
export {
  STEPS, PAYMENT_MODE_OPTIONS, bankEstimateOn, correctionOptions, developmentOf, isAnswerState, isPaymentFlow, paymentModeOptions, resolveCorrectionTarget,
  resultOptions, salesOf, summaryLines,
} from './steps';
export {
  MAX_FAILURES, applyInterpretation, enterResult, failSimulation, formSnapshot, handleNonText, initialSnapshot, interpretStep, questionFor, replyPreview,
  resumeAfterHandoff, withResume,
  type ResultArgs, type TurnMeta,
} from './machine';
