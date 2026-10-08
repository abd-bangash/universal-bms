/** Claims of an access token (design.md "Authentication, Sessions and Permissions"). */
export interface AccessTokenPayload {
  /** User id */
  sub: string;
  /** Workspace id: an access token is valid for exactly one workspace */
  tenantId: string;
  /** UserWorkspace (membership) id */
  mid: string;
  permissions: string[];
  /** permVersion of the membership when the token was issued */
  pv: number;
  /** Session family; lets a user see and end the session this token belongs to */
  fam: string;
  iat: number;
  exp: number;
}

export interface WorkspaceChoice {
  id: string;
  name: string;
}

export type LoginResult =
  | {
      requiresWorkspaceSelection: false;
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    }
  | { requiresWorkspaceSelection: true; loginTicket: string; workspaces: WorkspaceChoice[] };

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds */
  expiresIn: number;
}
