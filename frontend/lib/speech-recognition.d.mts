export type SpeechRecognitionAlternative = { transcript: string };
export type SpeechRecognitionResult = ArrayLike<SpeechRecognitionAlternative> & { isFinal: boolean };
export type SpeechRecognitionEvent = { resultIndex: number; results: ArrayLike<SpeechRecognitionResult> };
export type SpeechRecognitionErrorEvent = { error: string };
export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
export type SpeechRecognitionWindow = {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};
export type SpeechRecognitionEndState = {
  receivedTranscript: boolean;
  recognitionFailed: boolean;
};
export type SpeechRecognitionCallbacks = {
  onTranscript(transcript: string): void;
  onError(message: string): void;
  onEnd(state: SpeechRecognitionEndState): void;
  onStarted(recognition: SpeechRecognitionLike): void;
  onStartFailure(): void;
};

export function getSpeechRecognitionConstructor(
  browserWindow: SpeechRecognitionWindow,
): (new () => SpeechRecognitionLike) | null;
export function speechRecognitionErrorMessage(error: string): string;
export function startSpeechRecognition(
  browserWindow: SpeechRecognitionWindow,
  language: string,
  callbacks: SpeechRecognitionCallbacks,
): "unsupported" | "started" | "failed";
