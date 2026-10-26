import Schema from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
/** Language of the generated document. `auto` follows the conversation. */
type HandoffLanguage = 'auto' | 'zh' | 'en';
/** Effective plugin configuration. Every field has a default, so an empty entry is valid. */
interface HandoffConfig {
  /** Directory for generated documents, relative to the session working directory. */
  outputDir: string;
  /** Prefix of every generated file name. */
  filenamePrefix: string;
  /** Keep a `latest.md` copy beside the timestamped documents. */
  writeLatest: boolean;
  /** Provider route override; set together with `model`, or leave both empty to inherit. */
  provider: string;
  /** Model override; set together with `provider`. */
  model: string;
  /** Transcript character budget sent to the summarizer. */
  maxInputChars: number;
  /** Output-token cap for the summarizer call. */
  maxOutputTokens: number;
  /** Include tool results in the transcript. */
  includeToolResults: boolean;
  /** Include harness-injected user-role context (skill catalogs, workspace notes). */
  includeInjectedContext: boolean;
  /** Include the assistant's reasoning blocks in the transcript. */
  includeReasoning: boolean;
  /** Language of the generated document. */
  language: HandoffLanguage;
  /** Extra free-form instructions appended to the summarizer prompt. */
  extraInstructions: string;
}
/**
 * Plain configuration. These are ordinary profile-entry values: a change is
 * saved to the profile patch and takes effect on the next mount, which is the
 * right granularity for a batch job like this one. (`volatile()` is for config
 * references and would turn every value into a reference object.)
 */
export declare const Config: Schema<Schemastery.ObjectS<NoInfer<{
  outputDir: Schema<string, string, "defined">;
  filenamePrefix: Schema<string, string, "defined">;
  writeLatest: Schema<boolean, boolean, "defined">;
  provider: Schema<string, string, "defined">;
  model: Schema<string, string, "defined">;
  maxInputChars: Schema<number, number, "defined">;
  maxOutputTokens: Schema<number, number, "defined">;
  includeToolResults: Schema<boolean, boolean, "defined">;
  includeInjectedContext: Schema<boolean, boolean, "defined">;
  includeReasoning: Schema<boolean, boolean, "defined">;
  language: Schema<"auto" | "zh" | "en", "auto" | "zh" | "en", "defined">;
  extraInstructions: Schema<string, string, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
  outputDir: Schema<string, string, "defined">;
  filenamePrefix: Schema<string, string, "defined">;
  writeLatest: Schema<boolean, boolean, "defined">;
  provider: Schema<string, string, "defined">;
  model: Schema<string, string, "defined">;
  maxInputChars: Schema<number, number, "defined">;
  maxOutputTokens: Schema<number, number, "defined">;
  includeToolResults: Schema<boolean, boolean, "defined">;
  includeInjectedContext: Schema<boolean, boolean, "defined">;
  includeReasoning: Schema<boolean, boolean, "defined">;
  language: Schema<"auto" | "zh" | "en", "auto" | "zh" | "en", "defined">;
  extraInstructions: Schema<string, string, "defined">;
}>>, "plain">;
export declare const name = "dsh-handoff";
/** The tool and the command both need the model service; commands are optional. */
export declare const inject: string[];
/**
 * Register the handoff tool, and the `/handoff` command when the composition
 * provides a command surface (the Web client does; headless runs do not).
 */
export declare function apply(ctx: Context, config: HandoffConfig): void;
export {};