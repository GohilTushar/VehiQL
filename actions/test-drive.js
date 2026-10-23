"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/prisma";
import { serializeCarData } from "@/lib/helpers";

/**
 * Books a test drive for a car
 */
export async function bookTestDrive({
  carId,
  bookingDate,
  startTime,
  endTime,
  notes,
}) {
  try {
    // Authenticate user
    const { userId } = await auth();
    if (!userId) throw new Error("You must be logged in to book a test drive");

    // Run all pre-booking checks in parallel
    const [user, car, existingBooking] = await Promise.all([
      // Find user in our database
      db.user.findUnique({
        where: { clerkUserId: userId },
      }),

      // Check if car exists and is available
      db.car.findUnique({
        where: { id: carId, status: "AVAILABLE" },
        select: { id: true },
      }),

      // Check if slot is already booked
      db.testDriveBooking.findFirst({
        where: {
          carId,
          bookingDate: new Date(bookingDate),
          startTime,
          status: { in: ["PENDING", "CONFIRMED"] },
        },
        select: { id: true },
      }),
    ]);

    if (!user) throw new Error("User not found in database");

    if (!car) throw new Error("Car not available for test drive");

    if (existingBooking) {
      throw new Error(
        "This time slot is already booked. Please select another time."
      );
    }

    // Create the booking
    const booking = await db.testDriveBooking.create({
      data: {
        carId,
        userId: user.id,
        bookingDate: new Date(bookingDate),
        startTime,
        endTime,
        notes: notes || null,
        status: "PENDING",
      },
    });

    // Revalidate relevant paths
    revalidatePath(`/test-drive/${carId}`);
    revalidatePath(`/cars/${carId}`);

    return {
      success: true,
      data: booking,
    };
  } catch (error) {
    console.error("Error booking test drive:", error);
    return {
      success: false,
      error: error.message || "Failed to book test drive",
    };
  }
}

/**
 * Get user's test drive bookings - reservations page
 */
export async function getUserTestDrives() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return {
        success: false,
        error: "Unauthorized",
      };
    }

    // Get user's test drive bookings
    const bookings = await db.testDriveBooking.findMany({
      where: { user: { clerkUserId: userId } },
      include: {
        car: true,
      },
      orderBy: { bookingDate: "desc" },
    });

    // Format the bookings
    const formattedBookings = bookings.map((booking) => ({
      id: booking.id,
      carId: booking.carId,
      car: serializeCarData(booking.car),
      bookingDate: booking.bookingDate.toISOString(),
      startTime: booking.startTime,
      endTime: booking.endTime,
      status: booking.status,
      notes: booking.notes,
      createdAt: booking.createdAt.toISOString(),
      updatedAt: booking.updatedAt.toISOString(),
    }));

    return {
      success: true,
      data: formattedBookings,
    };
  } catch (error) {
    console.error("Error fetching test drives:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Cancel a test drive booking
 */
export async function cancelTestDrive(bookingId) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return {
        success: false,
        error: "Unauthorized",
      };
    }

    // Get the user and the booking in parallel
    const [user, booking] = await Promise.all([
      db.user.findUnique({
        where: { clerkUserId: userId },
      }),
      db.testDriveBooking.findUnique({
        where: { id: bookingId },
      }),
    ]);

    if (!user) {
      return {
        success: false,
        error: "User not found",
      };
    }

    if (!booking) {
      return {
        success: false,
        error: "Booking not found",
      };
    }

    // Only the booking owner or an admin can cancel
    if (booking.userId !== user.id && user.role !== "ADMIN") {
      return {
        success: false,
        error: "Unauthorized to cancel this booking",
      };
    }

    // Check if booking can be cancelled
    if (booking.status === "CANCELLED") {
      return {
        success: false,
        error: "Booking is already cancelled",
      };
    }

    if (booking.status === "COMPLETED") {
      return {
        success: false,
        error: "Cannot cancel a completed booking",
      };
    }

    // Update the booking status
    await db.testDriveBooking.update({
      where: { id: bookingId },
      data: { status: "CANCELLED" },
    });

    // Revalidate paths
    revalidatePath("/reservations");
    revalidatePath("/admin/test-drives");

    return {
      success: true,
      message: "Test drive cancelled successfully",
    };
  } catch (error) {
    console.error("Error cancelling test drive:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}
