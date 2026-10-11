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
// WHAT WAS CHECKED (web research 2026-10-11, sources in the panel's footnote of the PR): ChatGPT, Gemini, Claude and Grok have a connector screen on their
// websites (plan and country limits apply and change); the free Microsoft Copilot website has none; DeepSeek's and z.ai's websites have none we could
// confirm. Where a screen's exact wording could not be confirmed, the steps say where to LOOK and what to do if it is missing, instead of promising a menu.
// Vendors rename menus often: the check button at the end of each wizard (diagnoseConnection) is what tells the person whether it really worked.

export type OwnKeyVendor = "openai" | "anthropic" | "google" | "groq" | "openrouter";

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
      supportNote: "ChatGPT's website can connect to other apps only on some paid plans, and OpenAI changes which. If you cannot find \"Developer mode\" below, your plan does not allow it yet.",
      steps: [
        "Open chatgpt.com in your browser and sign in.",
        "Click your name or picture (bottom-left), then click Settings.",
        "Click \"Apps & Connectors\" (it may just say \"Connectors\").",
        "Click \"Advanced\" and switch ON \"Developer mode\".",
        "Click \"Create\" (or \"Add\"). In Name type PROJEXA. In the address/URL box paste the address from step 1. Under sign-in choose \"No authentication\". Tick \"I trust this application\" and click Create.",
        "Open a NEW chat, click the \"+\" next to the message box, pick PROJEXA, and type: Show my PROJEXA projects",
      ],
      ifMissing: "No \"Developer mode\" or no \"Create\" button means your ChatGPT plan cannot connect to other apps. Use \"Chat inside PROJEXA\" below instead (it needs an OpenAI developer key, which is separate from ChatGPT Plus).",
      mistakes: [PARTIAL_ADDRESS_MISTAKE, NO_SIGNIN_MISTAKE, NEW_CHAT_MISTAKE, "Developer mode was not switched on, so the Create button did not appear."],
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
      supportNote: "Google is adding this slowly. It may need a paid Google AI plan and may not be in your country yet. If you cannot find \"Connected apps\" below, the Gemini website cannot connect yet.",
      steps: [
        "Open gemini.google.com and sign in.",
        "Click \"Settings & help\" (bottom-left), then look for \"Connected apps\" (it may say \"Apps\").",
        "Click \"Add custom app\" (or \"Add MCP server\"). In Name type PROJEXA and paste the address from step 1 into the address box. Save.",
        "Open a NEW chat and type: Show my PROJEXA projects",
      ],
      ifMissing: "No \"Connected apps\" or no \"Add custom app\" means your Gemini cannot connect yet. Use \"Chat inside PROJEXA\" below instead (it needs a Google AI key, which is free to start and separate from your Gemini plan).",
      mistakes: [PARTIAL_ADDRESS_MISTAKE, NO_SIGNIN_MISTAKE, NEW_CHAT_MISTAKE, "The app was added but not switched on for this chat. Look for PROJEXA in the tools list of the message box and switch it on."],
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
    summary: "Work in PROJEXA from grok.com, or chat inside PROJEXA through an OpenRouter key.",
    website: {
      support: "depends",
      supportNote: "Grok's website has a screen for connecting other apps; xAI says custom connectors are for paid Grok plans. If you do not see it, your plan does not include it.",
      steps: [
        "Open grok.com in your browser and sign in.",
        "Open grok.com/connectors (or click your picture, then Settings, then Connectors).",
        "Click \"New Connector\", then choose \"Custom\".",
        "In Name type PROJEXA and paste the address from step 1 into the server URL box. If it asks how to sign in, choose none. Save.",
        "Open a NEW chat and type: Show my PROJEXA projects",
      ],
      ifMissing: "No \"New Connector\" or no \"Custom\" means your Grok plan cannot connect to other apps. Use \"Chat inside PROJEXA\" below instead.",
      mistakes: [PARTIAL_ADDRESS_MISTAKE, NO_SIGNIN_MISTAKE, NEW_CHAT_MISTAKE, "The connector was saved but not switched on for the chat. Look for PROJEXA in the connectors list of the message box."],
    },
    ownKey: {
      vendor: "openrouter",
      keyFrom: "OpenRouter",
      keyAddress: "openrouter.ai/keys",
      getKey: [
        "Open openrouter.ai and sign in. OpenRouter is one account that reaches Grok and many other AIs.",
        "Click \"Keys\", then \"Create key\", and copy it (it starts with sk-or-). Add a little credit under \"Credits\".",
        "When you connect, the model box already says x-ai/grok-4.",
      ],
    },
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    maker: "DeepSeek",
    summary: "DeepSeek's website cannot connect to other apps. Use DeepSeek inside PROJEXA with an OpenRouter key.",
    website: {
      support: "no",
      supportNote: "We found no way for chat.deepseek.com to connect to other apps, so the website cannot work in PROJEXA.",
      steps: [],
      ifMissing: "If you see a \"Connectors\" or \"MCP\" item in DeepSeek's settings, tell us and we will add the steps.",
      mistakes: [],
      instead: "Chat inside PROJEXA with DeepSeek: use the OpenRouter key steps below. DeepSeek answers your PROJEXA chat box.",
    },
    ownKey: {
      vendor: "openrouter",
      keyFrom: "OpenRouter",
      keyAddress: "openrouter.ai/keys",
      getKey: [
        "Open openrouter.ai and sign in. OpenRouter is one account that reaches DeepSeek and many other AIs.",
        "Click \"Keys\", then \"Create key\", and copy it (it starts with sk-or-). Add a little credit under \"Credits\".",
        "When you connect, the model box already says deepseek/deepseek-chat.",
      ],
    },
  },
  {
    id: "zai",
    name: "z.ai",
    maker: "Zhipu AI (GLM)",
    summary: "We could not confirm that chat.z.ai connects to other apps. Use GLM inside PROJEXA with an OpenRouter key.",
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
      vendor: "openrouter",
      keyFrom: "OpenRouter",
      keyAddress: "openrouter.ai/keys",
      getKey: [
        "Open openrouter.ai, sign in, click \"Keys\", then \"Create key\", and copy it (it starts with sk-or-). Add a little credit under \"Credits\".",
        "When you connect, change the model box to z-ai/glm-4.6 (or any GLM name OpenRouter lists).",
      ],
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
  openrouter: { label: "OpenRouter (DeepSeek, GLM, Grok, others)", defaultModel: "deepseek/deepseek-chat" },
};

/** What the model box starts with for a provider card: its own suggestion where the card names one, else the vendor's default. */
export function modelFor(provider: ConnectProvider): string {
  if (!provider.ownKey) return "";
  if (provider.id === "zai") return "z-ai/glm-4.6";
  if (provider.id === "grok") return "x-ai/grok-4";
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
  const issuer: Array<[string, OwnKeyVendor, string]> = [["sk-ant-", "anthropic", "Claude (Anthropic)"], ["sk-or-", "openrouter", "OpenRouter"], ["gsk_", "groq", "Groq"], ["AIza", "google", "Gemini (Google)"]];
  for (const [prefix, owner, name] of issuer) {
    if (key.startsWith(prefix) && vendor !== owner) return `This key starts with ${prefix}, which is a ${name} key. Pick ${name} instead (its own card, or the company box).`;
  }
  if (vendor === "openai" && !key.startsWith("sk-")) return "ChatGPT (OpenAI) keys start with sk-. This one does not, so it is probably the wrong thing (a password, or a key from another company). Copy the key from platform.openai.com/api-keys.";
  if (key.length < 20) return "That is too short to be a key. Keys are long (usually 40 letters and numbers or more). Make sure you copied all of it.";
  return null;
}
