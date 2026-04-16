import { drmfConfig } from "./drmf.js";
import { steelHeartsConfig } from "./steelhearts.js";

export { drmfConfig, steelHeartsConfig };

// All orgs keyed by orgId
export const orgs = {
  drmf: drmfConfig,
  "steel-hearts": steelHeartsConfig,
};

// Special admin users who can access all orgs
export const adminTokens = {
  "hb-admin-joseph-2026": {
    name: "Joseph Wiseman",
    email: "joseph.wiseman@steel-hearts.org",
    role: "Platform Admin",
  },
};

export function getOrgByToken(token) {
  return Object.values(orgs).find((org) => org.token === token) || null;
}

export function getOrgById(orgId) {
  return orgs[orgId] || null;
}

export function isAdminToken(token) {
  return token in adminTokens;
}

export function getAdminUser(token) {
  return adminTokens[token] || null;
}

export function getAllOrgs() {
  return Object.values(orgs);
}
