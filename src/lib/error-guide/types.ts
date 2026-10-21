// GUIDED ERROR RECOVERY -- the contract every guide in the catalogue is written against.
// Owner's requirement: an error never just says "error". It says what happened in full, tells the person EXACTLY what to do, takes them to
// the exact place it can be corrected, and brings them BACK with what they typed intact. Docs: docs/ERROR_GUIDE.md.

export type GuideSource =
  | "validation"
  | "server"
  | "network"
  | "auth"
  | "permission"
  | "prerequisite"
  | "conflict"
  | "upload"
  | "unknown";

/** Everything known about one failure at the moment it is shown. */
export type GuideContext = {
  /** The screen the person is on (pathname). */
  route: string;
  /** Its query string, with the leading "?" or empty. */
  search: string;
  projectId?: string;
  entityId?: string;
  entityType?: string;
  /** The input the problem is about, when the server (or the form) names one. */
  field?: string;
  /** The server's own words. */
  serverMessage?: string;
  /** HTTP status; 0 = the request never got an answer. */
  status?: number;
  /** A machine code: the server's own, or one of OFFLINE / TIMEOUT / NOT_SENT / UNCONFIRMED / RENDER. */
  code?: string;
  apiPath?: string;
  method?: string;
};

export type Guide = {
  id: string;
  source: GuideSource;
  /** Every key given must match; the guide with the most keys given (and the heavier ones) wins. */
  match: {
    status?: number | number[];
    code?: string;
    /** Case-insensitive regular expression tested against serverMessage. */
    messageRegex?: string;
    /** Matches when the call's path contains this text. */
    apiPath?: string;
    method?: string;
    field?: string;
  };
  /** Plain words, 8 or fewer. */
  title: string;
  /** What happened, one sentence. May contain {serverMessage}. */
  what: string;
  why: string;
  /** 1-4 numbered, imperative steps. */
  steps: string[];
  fix?: {
    label: string;
    /** The exact in-app URL, or a function of the context. */
    to: string | ((c: GuideContext) => string);
    /** Human description of the place, e.g. "Scope of Work > this BOQ > Approve". */
    where: string;
    /** data-testid / id / name of the element to scroll to and outline on arrival. */
    focus?: string;
  };
  retry?: boolean;
  severity: "info" | "warn" | "block";
  /** e.g. "Back to your new project". */
  returnLabel?: string;
};
