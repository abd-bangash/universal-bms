import type { ContextPack } from '../context.types';
import { renderConversation, renderPack, RULES, styleLine } from './common';

/**
 * One entry per AI function. `version` goes into every AIActionLog row, so a change in wording is
 * visible in the history of what the AI did; change it whenever the text below changes.
 */
export interface PromptSpec {
  version: string;
  system(pack: ContextPack): string;
  user(pack: ContextPack): string;
}

const about = (pack: ContextPack) =>
  `You help the staff of a ${pack.business.industryProfile} business handle customer messages. ${RULES}`;

export const SUMMARIZE: PromptSpec = {
  version: 'summarize.v1',
  system: (pack) =>
    `${about(pack)} Summarise the conversation for a colleague who has not read it: what the customer wants and where things stand.`,
  user: (pack) => `${renderPack(pack, ['known'])}\n\nConversation:\n${renderConversation(pack)}`,
};

export const EXTRACT: PromptSpec = {
  version: 'extract.v1',
  system: (pack) =>
    `${about(pack)} Read the conversation and extract what the customer has said they want. Return only details the customer stated, using the keys listed. Give the value as the customer worded it. Give a confidence from 0 to 1 for each. Return a product only if its id is in the matching products list; otherwise return none.`,
  user: (pack) =>
    `${renderPack(pack, ['fields', 'known', 'products'])}\n\nConversation:\n${renderConversation(pack)}`,
};

export const CLASSIFY: PromptSpec = {
  version: 'classify.v1',
  system: (pack) =>
    `${about(pack)} Classify the customer's intent and how urgent it is for the sales team.`,
  user: (pack) => `${renderPack(pack, ['known'])}\n\nConversation:\n${renderConversation(pack)}`,
};

export const DRAFT_REPLY: PromptSpec = {
  version: 'draft-reply.v1',
  system: (pack) =>
    `${about(pack)} Write the next reply to the customer, to be reviewed by staff before it is sent. ${styleLine(pack)} If details are still missing, ask for the first missing one using the question flow. State a price or availability only if it is listed under the matching products.`,
  user: (pack) =>
    `${renderPack(pack, ['fields', 'known', 'products', 'knowledge', 'bankAccounts', 'questionFlow'])}\n\nConversation:\n${renderConversation(pack)}`,
};

export const NEXT_ACTION: PromptSpec = {
  version: 'next-action.v1',
  system: (pack) =>
    `${about(pack)} Suggest the single most useful next step for the salesperson, and the date to follow up (YYYY-MM-DD) if one is called for.`,
  user: (pack) => `${renderPack(pack, ['known'])}\n\nConversation:\n${renderConversation(pack)}`,
};

export const NOTE: PromptSpec = {
  version: 'note.v1',
  system: (pack) =>
    `${about(pack)} Write a short internal note for the customer record: what was discussed and agreed, in plain sentences. It is for staff only.`,
  user: (pack) => `${renderPack(pack, ['known'])}\n\nConversation:\n${renderConversation(pack)}`,
};
