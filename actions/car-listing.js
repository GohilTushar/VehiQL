"use server";

import { serializeCarData } from "@/lib/helpers";
import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath, unstable_cache } from "next/cache";

/**
 * Get simplified filters for the car marketplace
 */
export async function getCarFilters() {
  try {
    return await getCachedCarFilters();
  } catch (error) {
    throw new Error("Error fetching car filters:" + error.message);
  }
}

// Filters only change when cars are added/updated/deleted, which revalidate the "cars" tag
const getCachedCarFilters = unstable_cache(
  async () => {
    // Run all filter queries in parallel
    const [makes, bodyTypes, fuelTypes, transmissions, priceAggregations] =
      await Promise.all([
        // Get unique makes
        db.car.findMany({
          where: { status: "AVAILABLE" },
          select: { make: true },
          distinct: ["make"],
          orderBy: { make: "asc" },
        }),

        // Get unique body types
        db.car.findMany({
          where: { status: "AVAILABLE" },
          select: { bodyType: true },
          distinct: ["bodyType"],
          orderBy: { bodyType: "asc" },
        }),

        // Get unique fuel types
        db.car.findMany({
          where: { status: "AVAILABLE" },
          select: { fuelType: true },
          distinct: ["fuelType"],
          orderBy: { fuelType: "asc" },
        }),

        // Get unique transmissions
        db.car.findMany({
          where: { status: "AVAILABLE" },
          select: { transmission: true },
          distinct: ["transmission"],
          orderBy: { transmission: "asc" },
        }),

        // Get min and max prices using Prisma aggregations
        db.car.aggregate({
          where: { status: "AVAILABLE" },
          _min: { price: true },
          _max: { price: true },
        }),
      ]);

    return {
      success: true,
      data: {
        makes: makes.map((item) => item.make),
        bodyTypes: bodyTypes.map((item) => item.bodyType),
        fuelTypes: fuelTypes.map((item) => item.fuelType),
        transmissions: transmissions.map((item) => item.transmission),
        priceRange: {
          min: priceAggregations._min.price
            ? parseFloat(priceAggregations._min.price.toString())
            : 0,
          max: priceAggregations._max.price
            ? parseFloat(priceAggregations._max.price.toString())
            : 100000,
        },
      },
    };
  },
  ["car-filters"],
  { tags: ["cars"], revalidate: 3600 }
);

/**
 * Get cars with simplified filters
 */
export async function getCars({
  search = "",
  make = "",
  bodyType = "",
  fuelType = "",
  transmission = "",
  minPrice = 0,
  maxPrice = Number.MAX_SAFE_INTEGER,
  sortBy = "newest", // Options: newest, priceAsc, priceDesc
  page = 1,
  limit = 6,
}) {
  try {
    // Get current user if authenticated
    const { userId } = await auth();

    // Build where conditions
    let where = {
      status: "AVAILABLE",
    };

    if (search) {
      where.OR = [
        { make: { contains: search, mode: "insensitive" } },
        { model: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    if (make) where.make = { equals: make, mode: "insensitive" };
    if (bodyType) where.bodyType = { equals: bodyType, mode: "insensitive" };
    if (fuelType) where.fuelType = { equals: fuelType, mode: "insensitive" };
    if (transmission)
      where.transmission = { equals: transmission, mode: "insensitive" };

    // Add price range
    where.price = {
      gte: parseFloat(minPrice) || 0,
    };

    if (maxPrice && maxPrice < Number.MAX_SAFE_INTEGER) {
      where.price.lte = parseFloat(maxPrice);
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Determine sort order
    let orderBy = {};
    switch (sortBy) {
      case "priceAsc":
        orderBy = { price: "asc" };
        break;
      case "priceDesc":
        orderBy = { price: "desc" };
        break;
      case "newest":
      default:
        orderBy = { createdAt: "desc" };
        break;
    }

    // Count, page of cars and the user's saved cars are independent, so fetch in parallel
    const [totalCars, cars, savedCars] = await Promise.all([
      // Get total count for pagination
      db.car.count({ where }),

      // Execute the main query
      db.car.findMany({
        where,
        take: limit,
        skip,
        orderBy,
      }),

      // If we have a user, check which cars are wishlisted
      userId
        ? db.userSavedCar.findMany({
            where: { user: { clerkUserId: userId } },
            select: { carId: true },
          })
        : [],
    ]);

    const wishlisted = new Set(savedCars.map((saved) => saved.carId));

    // Serialize and check wishlist status
    const serializedCars = cars.map((car) =>
      serializeCarData(car, wishlisted.has(car.id))
    );

    return {
      success: true,
      data: serializedCars,
      pagination: {
        total: totalCars,
        page,
        limit,
        pages: Math.ceil(totalCars / limit),
      },
    };
  } catch (error) {
    throw new Error("Error fetching cars:" + error.message);
  }
}

/**
 * Toggle car in user's wishlist
 */
export async function toggleSavedCar(carId) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    // Try to remove an existing save while looking up the user in parallel
    const [removed, user] = await Promise.all([
      db.userSavedCar.deleteMany({
        where: { carId, user: { clerkUserId: userId } },
      }),
      db.user.findUnique({
        where: { clerkUserId: userId },
        select: { id: true },
      }),
    ]);

    if (!user) throw new Error("User not found");

    // If car was already saved, it has now been removed
    if (removed.count > 0) {
      revalidatePath(`/saved-cars`);
      return {
        success: true,
        saved: false,
        message: "Car removed from favorites",
      };
    }

    // If car is not saved, add it (the foreign key rejects unknown cars)
    try {
      await db.userSavedCar.create({
        data: {
          userId: user.id,
          carId,
        },
      });
    } catch (error) {
      if (error.code === "P2003") {
        return {
          success: false,
          error: "Car not found",
        };
      }
      throw error;
    }

    revalidatePath(`/saved-cars`);
    return {
      success: true,
      saved: true,
      message: "Car added to favorites",
    };
  } catch (error) {
    throw new Error("Error toggling saved car:" + error.message);
  }
}

/**
 * Get car details by ID
 */
export async function getCarById(carId) {
  try {
    // Get current user if authenticated
    const { userId } = await auth();

    // All lookups are independent, so fetch them in parallel
    const [car, savedCar, existingTestDrive, dealership] = await Promise.all([
      // Get car details
      db.car.findUnique({
        where: { id: carId },
      }),

      // Check if car is wishlisted by user
      userId
        ? db.userSavedCar.findFirst({
            where: { carId, user: { clerkUserId: userId } },
          })
        : null,

      // Check if user has already booked a test drive for this car
      userId
        ? db.testDriveBooking.findFirst({
            where: {
              carId,
              user: { clerkUserId: userId },
              status: { in: ["PENDING", "CONFIRMED", "COMPLETED"] },
            },
            orderBy: {
              createdAt: "desc",
            },
          })
        : null,

      // Get dealership info for test drive availability
      db.dealershipInfo.findFirst({
        include: {
          workingHours: true,
        },
      }),
    ]);

    if (!car) {
      return {
        success: false,
        error: "Car not found",
      };
    }

    const isWishlisted = !!savedCar;

    let userTestDrive = null;

    if (existingTestDrive) {
      userTestDrive = {
        id: existingTestDrive.id,
        status: existingTestDrive.status,
        bookingDate: existingTestDrive.bookingDate.toISOString(),
      };
    }

    return {
      success: true,
      data: {
        ...serializeCarData(car, isWishlisted),
        testDriveInfo: {
          userTestDrive,
          dealership: dealership
            ? {
                ...dealership,
                createdAt: dealership.createdAt.toISOString(),
                updatedAt: dealership.updatedAt.toISOString(),
                workingHours: dealership.workingHours.map((hour) => ({
                  ...hour,
                  createdAt: hour.createdAt.toISOString(),
                  updatedAt: hour.updatedAt.toISOString(),
                })),
              }
            : null,
        },
      },
    };
  } catch (error) {
    throw new Error("Error fetching car details:" + error.message);
  }
}

/**
 * Get user's saved cars
 */
export async function getSavedCars() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return {
        success: false,
        error: "Unauthorized",
      };
    }

    // Get saved cars with their details
    const savedCars = await db.userSavedCar.findMany({
      where: { user: { clerkUserId: userId } },
      include: {
        car: true,
      },
      orderBy: { savedAt: "desc" },
    });

    // Extract and format car data
    const cars = savedCars.map((saved) => serializeCarData(saved.car));

    return {
      success: true,
      data: cars,
    };
  } catch (error) {
    console.error("Error fetching saved cars:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}
