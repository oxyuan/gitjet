import type { CommitSignature } from "./mygo";

/** The tone a verification status paints: good, bad, or nothing at all
 *  for a commit that carries no signature. */
export function signatureTone(status: string): "good" | "bad" | "" {
  if (status === "G" || status === "U") return "good";
  if (status === "N" || status === "") return "";
  return "bad";
}

/** SignatureStatus is one of git's %G? letters, or empty when there is no
 *  signature. Only "G" proves the commit is the one its author signed. */
export type SignatureStatus = "" | "G" | "B" | "U" | "X" | "Y" | "R" | "E" | "N";

/** signatureKey is the i18n key a status letter stands for, or null for a
 *  commit without a signature. */
export function signatureKey(status: string): SignatureKey | null {
  switch (status) {
    case "G":
      return "signatureGood";
    case "B":
      return "signatureBad";
    case "U":
      return "signatureUntrusted";
    case "X":
      return "signatureExpired";
    case "Y":
      return "signatureExpiredKey";
    case "R":
      return "signatureRevoked";
    case "E":
      return "signatureUnknown";
  }
  return null;
}

export type SignatureKey =
  | "signatureGood"
  | "signatureBad"
  | "signatureUntrusted"
  | "signatureExpired"
  | "signatureExpiredKey"
  | "signatureRevoked"
  | "signatureUnknown";

/** hasSignature says whether the badge is worth drawing at all. */
export function hasSignature(signature: CommitSignature | undefined): boolean {
  return !!signature?.checked && signatureKey(signature.status) !== null;
}
