// The AIs the "+ Connect to AI" panel lists, in the owner's order (2026-10-11): ChatGPT, Gemini, Copilot, Grok, DeepSeek, z.ai, then Claude and Others.
// Words only: no network call. Written for people who are NOT technical and use the AI's WEBSITE.
//
// TWO different things can be "connected", and every card keeps them apart:
//   A. WORK FROM THE AI'S WEBSITE (`website`). PROJEXA makes a private code (an address). The person pastes it into the connector screen of the AI's own
//      website; from then on the AI works in PROJEXA for them, inside their role (create, edit, delete). No key, no developer account. Possible only
//      where that website has a connector screen: `support` says honestly whether it does.
//   B. CHAT INSIDE PROJEXA (`ownKey`). The person (or their organisation) pastes a developer KEY from the AI company; the chat box in PROJEXA is then
//      answered by that AI. A website subscription (ChatGPT Plus, Claude Pro, Gemini Advanced, Copilot) is NOT a key and cannot do this.
//
// WHAT WAS CHECKED (the companies' own documentation, read 2026-10-11): xAI docs.x.ai/grok/connectors (grok.com/connectors > New Connector > Custom, "available
// to all Grok users", admin first on Business/Enterprise); OpenAI's help article "Developer mode and MCP apps in ChatGPT" (full read-and-write MCP is a beta for Business,
// Enterprise and Edu; on Business only admins; User Settings > Apps > Advanced settings > Developer mode); DeepSeek api-docs.deepseek.com (platform.deepseek.com/api_keys,
// OpenAI format at https://api.deepseek.com, model deepseek-flash); Z.ai docs.z.ai (z.ai/manage-apikey/apikey-list, https://api.z.ai/api/paas/v4, model glm-5); xAI
// docs.x.ai (https://api.x.ai/v1, model grok-4.20-0309-non-reasoning); Gemini and Copilot have no first-party page we could read, so those cards rest on the sources
// named in the PR and say "depends" or "no". Also checked by web search: ChatGPT, Gemini, Claude and Grok have a connector screen on their
// websites (plan and country limits apply and change); the free Microsoft Copilot website has none; DeepSeek's and z.ai's websites have none we could
// confirm. Where a screen's exact wording could not be confirmed, the steps say where to LOOK and what to do if it is missing, instead of promising a menu.
// Vendors rename menus often: the check button at the end of each wizard (diagnoseConnection) is what tells the person whether it really worked.

export type OwnKeyVendor = "openai" | "anthropic" | "google" | "groq" | "openrouter" | "deepseek" | "zai" | "xai";

export type ConnectProviderId = "chatgpt" | "gemini" | "copilot" | "grok" | "deepseek" | "zai" | "claude" | "others";

/** works = the website has a connector screen on the plans that include it; depends = rolling out / plan or country limits; no = no way from the website. */
export type WebsiteSupport = "works" | "depends" | "no";

export type ConnectProvider = {
  id: ConnectProviderId;
  name: string;
  /** The company behind it, for the panel's small print. */
  maker: string;
  /** One line under the name in the list. */
  summary: string;
  website: {
    support: WebsiteSupport;
    /** The honest sentence about whether this website can connect at all, shown first. */
    supportNote: string;
    /** Where to click on the AI's website, after the person has pasted nothing yet: each line is ONE action. The address is made in step 1 of the wizard. */
    steps: string[];
    /** What to do when the connector screen is missing (the most common reason for "nothing happens"). */
    ifMissing: string;
    /** The mistakes people actually make; shown when the check finds the AI has not called PROJEXA yet. */
    mistakes: string[];
    /** Where to go instead when the website cannot connect. */
    instead?: string;
  };
  /** B. The key route, or null when this AI sells no key PROJEXA can use. */
  ownKey: null | {
    vendor: OwnKeyVendor;
    /** The company the key is bought from (for AIs reached through a broker this differs from `maker`). */
    keyFrom: string;
    getKey: string[];
    keyAddress: string;
    note?: string;
  };
  noKeyNote?: string;
};

const NEW_CHAT_MISTAKE = "You did not start a NEW chat after adding it. Old chats do not see new connectors: open a fresh chat and try again.";
const PARTIAL_ADDRESS_MISTAKE = "Only part of the address was pasted. Use the big Copy button above and paste it again: it is long and ends in a long code.";
const NO_SIGNIN_MISTAKE = "The connector asks how to sign in. Choose \"No authentication\" (or \"None\"). The code inside the address is already the sign-in; asking for a second one makes it fail.";

export const CONNECT_PROVIDERS: readonly ConnectProvider[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    maker: "OpenAI",
    summary: "Work in PROJEXA from the ChatGPT website, or chat inside PROJEXA with your OpenAI key.",
    website: {
      support: "depends",
      supportNote: "OpenAI says connections that can create, edit and delete are in beta for ChatGPT Business, Enterprise and Edu (on Business only the workspace admin can switch them on). Their pages disagree about Plus and Pro, and some say those plans can only read. If you cannot find \"Developer mode\" below, your plan does not allow it.",
      steps: [
        "Open chatgpt.com in your browser and sign in.",
        "Click your name or picture (bottom-left), then click Settings.",
        "Click \"Apps\" (older versions say \"Apps & Connectors\" or \"Connectors\").",
        "Click \"Advanced settings\" and switch ON \"Developer mode\". (If you run a Business workspace and cannot see it, ask the workspace admin: it is under Workspace settings, then Apps.)",
        "Click \"Create\" (or \"Add\"). In Name type PROJEXA. In the address/URL box paste the address from step 1. Under sign-in choose \"No authentication\". Tick \"I trust this application\" and click Create.",
        "Open a NEW chat, click the \"+\" next to the message box, pick PROJEXA, and type: Show my PROJEXA projects",
      ],
      ifMissing: "No \"Developer mode\" or no \"Create\" button means your ChatGPT plan cannot connect to other apps. Use \"Chat inside PROJEXA\" below instead (it needs an OpenAI developer key, which is separate from ChatGPT).",
      mistakes: [PARTIAL_ADDRESS_MISTAKE, NO_SIGNIN_MISTAKE, NEW_CHAT_MISTAKE, "Developer mode was not switched on, so the Create button did not appear.", "ChatGPT can read your projects but cannot create, change or delete anything: your plan only allows reading. Chat inside PROJEXA (part B) does not have this limit."],
    },
    ownKey: {
      vendor: "openai",
      keyFrom: "OpenAI",
      keyAddress: "platform.openai.com/api-keys",
      getKey: [
        "Open platform.openai.com and sign in. This is OpenAI's developer site, not the ChatGPT chat page.",
        "Click \"API keys\", then \"Create new secret key\", and copy the key (it starts with sk-).",
        "Open \"Billing\" and add a few dollars of credit. The key is paid by use, separately from a ChatGPT Plus plan.",
      ],
      note: "Your ChatGPT password and your Plus plan are not a key.",
    },
  },
  {
    id: "gemini",
    name: "Gemini",
    maker: "Google",
    summary: "Work in PROJEXA from the Gemini website, or chat inside PROJEXA with your Google AI key.",
    website: {
      support: "depends",
      supportNote: "Google is adding this slowly, and its own pages are hard to find. Guides we could read say it needs a paid Google AI plan (Ultra, and some say Pro), a personal Google account (not work or school), an adult, English, and at the time of writing the United States. If you cannot find \"Add a custom app\" below, your Gemini cannot connect yet.",
      steps: [
        "Open gemini.google.com in a browser on a computer (not the phone app) and sign in with your personal Google account.",
        "Click \"Settings & help\" at the bottom of the left side, then \"Connected apps\". If you do not see it, look under \"Personal Intelligence\" first.",
        "Under \"Custom apps for Spark\" click \"Add a custom app\". Paste the address from step 1 into the \"MCP server URL\" box, leave \"Advanced features\" alone, and click \"Next\".",
        "If a small window asks about access, read it and click \"Allow\".",
        "Open a NEW chat and type: Use PROJEXA to show my projects. (The first time, say the name PROJEXA in your message.)",
      ],
      ifMissing: "No \"Connected apps\" or no \"Add custom app\" means your Gemini cannot connect yet. Use \"Chat inside PROJEXA\" below instead (it needs a Google AI key, which is free to start and separate from your Gemini plan).",
      mistakes: [PARTIAL_ADDRESS_MISTAKE, NEW_CHAT_MISTAKE, "You did not say the name PROJEXA in your first message. Gemini only uses a connected app when you name it.", "Gemini's \"Activity\" setting is switched off. Gemini cannot use connected apps unless Activity is on.", "You used a work or school Google account, or the Gemini phone app. Use a personal account in a browser on a computer."],
    },
    ownKey: {
      vendor: "google",
      keyFrom: "Google",
      keyAddress: "aistudio.google.com/apikey",
      getKey: [
        "Open aistudio.google.com/apikey and sign in with your Google account.",
        "Click \"Create API key\" and copy it (it starts with AIza).",
        "A free tier exists with daily limits; a paid one lifts them.",
      ],
      note: "A Gemini Advanced or Google One plan is not a key.",
    },
  },
  {
    id: "copilot",
    name: "Copilot",
    maker: "Microsoft",
    summary: "The free Copilot website cannot connect to other apps. Read how your company can.",
    website: {
      support: "no",
      supportNote: "The Copilot website (copilot.microsoft.com) has no way to connect to other apps. Only Copilot inside your company's Microsoft 365 can, and your company's IT administrator has to set that up.",
      steps: [
        "Press \"Make my PROJEXA code\" in step 1 and copy the address.",
        "Send it to your company's IT administrator with this sentence: \"Please add this as a custom MCP connector for Microsoft 365 Copilot in the Microsoft 365 admin center.\"",
        "When they say it is done, open Copilot at work, start a new chat, and type: Show my PROJEXA projects",
      ],
      ifMissing: "If your company does not use Microsoft 365 Copilot, this cannot work. Pick another AI in the list; Copilot has no developer key that PROJEXA can use.",
      mistakes: ["The administrator added it but did not turn it on for your group. Ask them to check who it is available to.", PARTIAL_ADDRESS_MISTAKE, NEW_CHAT_MISTAKE],
      instead: "Use ChatGPT, Gemini, Grok or Claude from the list.",
    },
    ownKey: null,
    noKeyNote: "Microsoft Copilot gives out no developer key that PROJEXA can use, so it cannot answer inside PROJEXA's chat box.",
  },
  {
    id: "grok",
    name: "Grok",
    maker: "xAI",
    summary: "Work in PROJEXA from grok.com, or chat inside PROJEXA with your xAI key.",
    website: {
      support: "works",
      supportNote: "xAI's documentation says connectors are available to all Grok users. If your company uses Grok Business or Enterprise, your team admin has to switch the connector on first.",
      steps: [
        "Open grok.com in your browser and sign in.",
        "Open grok.com/connectors in your browser.",
        "Click \"New Connector\", then choose \"Custom\".",
        "Paste the address from step 1 into the server URL box. If it asks for authentication, leave it empty or choose none: the code inside the address is already the sign-in. Save.",
        "Open a NEW chat and type: Show my PROJEXA projects",
      ],
      ifMissing: "No \"New Connector\" or no \"Custom\" usually means your company's Grok admin has not allowed it yet. Ask them, or use \"Chat inside PROJEXA\" below instead.",
      mistakes: [PARTIAL_ADDRESS_MISTAKE, NO_SIGNIN_MISTAKE, NEW_CHAT_MISTAKE, "The connector was saved but not switched on for the chat. Look for PROJEXA in the connectors list of the message box."],
    },
    ownKey: {
      vendor: "xai",
      keyFrom: "xAI",
      keyAddress: "console.x.ai",
      getKey: [
        "Open console.x.ai (xAI's developer site, not the Grok chat page) and sign in.",
        "Open \"API Keys\", click to create a key, and copy it (it starts with xai-).",
        "Add a little credit under billing. The key is paid by use, separately from a Grok plan.",
      ],
      note: "Your Grok or X login is not a key.",
    },
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    maker: "DeepSeek",
    summary: "DeepSeek's website cannot connect to other apps. Use DeepSeek inside PROJEXA with an OpenRouter key.",
    website: {
      support: "no",
      supportNote: "DeepSeek's documentation describes no connector for its website (chat.deepseek.com), so the website cannot work in PROJEXA.",
      steps: [],
      ifMissing: "If you see a \"Connectors\" or \"MCP\" item in DeepSeek's settings, tell us and we will add the steps.",
      mistakes: [],
      instead: "Chat inside PROJEXA with DeepSeek: use the key steps in part B below. DeepSeek then answers your PROJEXA chat box.",
    },
    ownKey: {
      vendor: "deepseek",
      keyFrom: "DeepSeek",
      keyAddress: "platform.deepseek.com/api_keys",
      getKey: [
        "Open platform.deepseek.com (DeepSeek's developer site, not the chat page) and sign in or register.",
        "Open \"API keys\", click to create a new key, and copy it (it starts with sk-).",
        "Add a little balance under top-up. The key is paid by use, separately from the DeepSeek chat website.",
      ],
      note: "Your DeepSeek chat login is not a key.",
    },
  },
  {
    id: "zai",
    name: "z.ai",
    maker: "Zhipu AI (GLM)",
    summary: "We could not confirm that chat.z.ai connects to other apps. Use GLM inside PROJEXA with a Z.ai key.",
    website: {
      support: "no",
      supportNote: "We could not confirm that chat.z.ai can connect to other apps. If its settings show \"MCP\" or \"Connectors\", follow the same steps as Grok below; if not, it cannot.",
      steps: [
        "Open chat.z.ai and sign in, then open its settings and look for \"MCP\" or \"Connectors\".",
        "If you find it, click to add a new one, name it PROJEXA, and paste the address from step 1.",
        "Open a NEW chat and type: Show my PROJEXA projects",
      ],
      ifMissing: "No \"MCP\" or \"Connectors\" item means z.ai's website cannot connect. Use \"Chat inside PROJEXA\" below instead.",
      mistakes: [PARTIAL_ADDRESS_MISTAKE, NO_SIGNIN_MISTAKE, NEW_CHAT_MISTAKE],
    },
    ownKey: {
      vendor: "zai",
      keyFrom: "Z.ai",
      keyAddress: "z.ai/manage-apikey/apikey-list",
      getKey: [
        "Open z.ai/model-api (the Z.ai Open Platform, not the chat page) and sign in or register.",
        "Add a little credit on the billing page (z.ai/manage-apikey/billing).",
        "Open z.ai/manage-apikey/apikey-list, click to create an API key, and copy it.",
      ],
      note: "Your Z.ai chat login is not a key.",
    },
  },
  {
    id: "claude",
    name: "Claude",
    maker: "Anthropic",
    summary: "Work in PROJEXA from claude.ai, or chat inside PROJEXA with your Anthropic key.",
    website: {
      support: "works",
      supportNote: "Claude's website can connect to other apps on its paid plans (Pro, Max, Team). The free plan cannot.",
      steps: [
        "Open claude.ai and sign in.",
        "Click your name (bottom-left), then Settings, then \"Connectors\".",
        "Click \"Add custom connector\". In Name type PROJEXA and paste the address from step 1 into the address box. Click Add.",
        "Open a NEW chat, click the connectors icon next to the message box, make sure PROJEXA is ON, and type: Show my PROJEXA projects",
      ],
      ifMissing: "No \"Add custom connector\" means you are on the free plan. Use \"Chat inside PROJEXA\" below instead, or upgrade the plan.",
      mistakes: [PARTIAL_ADDRESS_MISTAKE, NEW_CHAT_MISTAKE, "PROJEXA was added but is switched OFF for this chat. Open the connectors icon next to the message box and switch it on.", "Claude asked you to sign in to PROJEXA. You should not need to: remove the connector and add it again with the full address."],
    },
    ownKey: {
      vendor: "anthropic",
      keyFrom: "Anthropic",
      keyAddress: "console.anthropic.com/settings/keys",
      getKey: [
        "Open console.anthropic.com and sign in. This is the developer console, not the Claude chat page.",
        "Click \"API keys\", then \"Create key\", and copy it (it starts with sk-ant-).",
        "Add credit under \"Billing\". The key is paid by use, separately from a Claude Pro plan.",
      ],
      note: "A Claude Pro or Max plan is not a key.",
    },
  },
  {
    id: "others",
    name: "Others",
    maker: "Any other AI",
    summary: "Any other AI: a Groq or OpenRouter key inside PROJEXA, or its connector screen if it has one.",
    website: {
      support: "depends",
      supportNote: "Some other AI websites have a screen called \"Connectors\", \"MCP\", \"Tools\" or \"Integrations\" where you can add your own. If yours has one, it works the same way. If not, it cannot connect.",
      steps: [
        "Open your AI's website and sign in, then open its settings.",
        "Look for \"Connectors\", \"MCP\", \"Tools\" or \"Integrations\" and click \"Add\" or \"New\" (choose \"Custom\" if it asks).",
        "Name it PROJEXA, paste the address from step 1, and choose no sign-in. Save.",
        "Open a NEW chat and type: Show my PROJEXA projects",
      ],
      ifMissing: "If you find no such screen, that AI's website cannot connect. Use \"Chat inside PROJEXA\" below instead.",
      mistakes: [PARTIAL_ADDRESS_MISTAKE, NO_SIGNIN_MISTAKE, NEW_CHAT_MISTAKE],
    },
    ownKey: {
      vendor: "openrouter",
      keyFrom: "OpenRouter (hundreds of AIs, one key)",
      keyAddress: "openrouter.ai/keys",
      getKey: [
        "Open openrouter.ai, sign in, click \"Keys\", then \"Create key\", and copy it (it starts with sk-or-). Add a little credit under \"Credits\".",
        "Type the model you want in the model box (openrouter.ai/models lists them).",
        "Want the fastest answers? A Groq key (console.groq.com/keys) with the Groq choice answers in about a second.",
      ],
    },
  },
];

/** The vendors the key form offers, with the model PROJEXA starts with (a fast, low-cost one, so answers take about a second or two). */
export const OWN_KEY_VENDORS: Readonly<Record<OwnKeyVendor, { label: string; defaultModel: string }>> = {
  openai: { label: "ChatGPT (OpenAI)", defaultModel: "gpt-4o-mini" },
  anthropic: { label: "Claude (Anthropic)", defaultModel: "claude-haiku-5-5" },
  google: { label: "Gemini (Google)", defaultModel: "gemini-2.0-flash" },
  groq: { label: "Groq (very fast)", defaultModel: "llama-3.3-70b-versatile" },
  openrouter: { label: "OpenRouter (hundreds of AIs)", defaultModel: "deepseek/deepseek-chat" },
  deepseek: { label: "DeepSeek", defaultModel: "deepseek-flash" },
  zai: { label: "z.ai (GLM)", defaultModel: "glm-5" },
  xai: { label: "Grok (xAI)", defaultModel: "grok-4.20-0309-non-reasoning" },
};

/** The vendors the ORGANISATION's connection takes (its database column is an enum of these five); a person may use all eight. */
export const ORG_KEY_VENDORS: readonly OwnKeyVendor[] = ["openai", "anthropic", "google", "groq", "openrouter"];

/** What the model box starts with for a provider card: its own suggestion where the card names one, else the vendor's default. */
export function modelFor(provider: ConnectProvider): string {
  if (!provider.ownKey) return "";
  return OWN_KEY_VENDORS[provider.ownKey.vendor].defaultModel;
}

/**
 * Catches the mistakes people make with a KEY before anything is sent, in plain words. null = nothing wrong that can be seen from the text alone
 * (the service then tests the key for real). A key's first letters say which company issued it, so a key pasted under the wrong company is named.
 */
export function checkKeyFormat(vendor: OwnKeyVendor, rawKey: string): string | null {
  const key = rawKey.trim();
  if (key.length === 0) return "Paste your key first.";
  if (/\s/.test(key)) return "The key has a space or a line break inside it. Copy it again; a key is one unbroken piece.";
  if (/^https?:\/\//i.test(key) || key.includes("/functions/v1/")) return "That is a web address, not a key. A key is a long code of letters and numbers that your AI company shows you under \"API keys\".";
  if (key.includes("@")) return "That looks like an email address. A key is a long code your AI company gives you under \"API keys\"; your email and password do not work here.";
  const issuer: Array<[string, OwnKeyVendor, string]> = [["sk-ant-", "anthropic", "Claude (Anthropic)"], ["sk-or-", "openrouter", "OpenRouter"], ["gsk_", "groq", "Groq"], ["AIza", "google", "Gemini (Google)"], ["xai-", "xai", "Grok (xAI)"]];
  for (const [prefix, owner, name] of issuer) {
    if (key.startsWith(prefix) && vendor !== owner) return `This key starts with ${prefix}, which is a ${name} key. Pick ${name} instead (its own card, or the company box).`;
  }
  if (vendor === "openai" && !key.startsWith("sk-")) return "ChatGPT (OpenAI) keys start with sk-. This one does not, so it is probably the wrong thing (a password, or a key from another company). Copy the key from platform.openai.com/api-keys.";
  if (key.length < 20) return "That is too short to be a key. Keys are long (usually 40 letters and numbers or more). Make sure you copied all of it.";
  return null;
}
