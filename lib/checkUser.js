import { cache } from "react";
import { unstable_cache } from "next/cache";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "./prisma";

// Cached across requests so rendering the header/admin layout doesn't cost a
// DB round trip on every page. Role changes revalidate the "users" tag.
// Server actions still check roles against the DB directly.
const getCachedDbUser = unstable_cache(
  async (clerkUserId) => {
    const user = await db.user.findUnique({
      where: {
        clerkUserId,
      },
    });

    // Throwing keeps "not found" out of the cache, so new users are picked up
    if (!user) throw new Error("USER_NOT_FOUND");

    return user;
  },
  ["db-user"],
  { tags: ["users"], revalidate: 300 }
);

// Deduped per request, so the header(s) and admin layout share one lookup
export const getDbUser = cache(async (clerkUserId) => {
  try {
    return await getCachedDbUser(clerkUserId);
  } catch (error) {
    if (error.message === "USER_NOT_FOUND") return null;
    throw error;
  }
});

export const checkUser = async () => {
  // auth() verifies the session token locally (no network call), so use it
  // first and only hit the Clerk API when the user isn't in our DB yet
  const { userId } = await auth();

  if (!userId) {
    return null;
  }

  try {
    const loggedInUser = await getDbUser(userId);

    if (loggedInUser) {
      return loggedInUser;
    }

    const user = await currentUser();

    if (!user) {
      return null;
    }

    const name = `${user.firstName} ${user.lastName}`;

    const newUser = await db.user.create({
      data: {
        clerkUserId: user.id,
        name,
        imageUrl: user.imageUrl,
        email: user.emailAddresses[0].emailAddress,
      },
    });

    return newUser;
  } catch (error) {
    console.log(error.message);
  }
};
