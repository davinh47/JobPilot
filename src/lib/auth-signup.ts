type SignupUser = {
  identities?: readonly unknown[] | null;
} | null | undefined;

export function signupResultIndicatesExistingAccount(user: SignupUser) {
  return Array.isArray(user?.identities) && user.identities.length === 0;
}
