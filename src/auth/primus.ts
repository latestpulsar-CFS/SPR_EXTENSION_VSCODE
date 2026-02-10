import * as vscode from "vscode";

const EXPECTED_PHRASE = "PR1MUS AUTORISE";

export interface PrimusCredentials {
  user: string;
  password: string;
  phrase: string;
}

export async function requestPrimusCredentials(): Promise<PrimusCredentials | undefined> {
  const user = await vscode.window.showInputBox({
    title: "SPHER Priority Authorization",
    prompt: "Pseudo",
    ignoreFocusOut: true
  });
  if (!user) {
    return undefined;
  }

  const password = await vscode.window.showInputBox({
    title: "SPHER Priority Authorization",
    prompt: "Mot de passe",
    password: true,
    ignoreFocusOut: true
  });
  if (!password) {
    return undefined;
  }

  const phrase = await vscode.window.showInputBox({
    title: "SPHER Priority Authorization",
    prompt: "Phrase d'autorisation (PR1MUS AUTORISE)",
    ignoreFocusOut: true,
    value: EXPECTED_PHRASE
  });
  if (!phrase) {
    return undefined;
  }

  return { user, password, phrase };
}

export function isPrimusPhraseValid(phrase: string): boolean {
  return phrase.trim().toUpperCase() === EXPECTED_PHRASE;
}
