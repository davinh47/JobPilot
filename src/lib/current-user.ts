import { cache } from "react";
import { headers } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authIdentityFromVerifiedHeader, verifiedIdentityHeader } from "@/lib/auth-claims";
import { isCloudDeployment } from "@/lib/deployment";

export const getCurrentUser = cache(async () => {
  if (!isCloudDeployment) return db.select().from(users).limit(1).get();
  return authIdentityFromVerifiedHeader((await headers()).get(verifiedIdentityHeader));
});
