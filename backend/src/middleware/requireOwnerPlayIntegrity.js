import { isRunningDevice } from "../constants/enrollmentModes.js";
import { Device } from "../models/Device.js";
import { User } from "../models/User.js";
import { runningModeError } from "../services/runningDevicePolicy.service.js";
import { sendError } from "../utils/apiResponse.js";

/** Play Integrity is available only to owner-provisioned borrowers, including legacy rows. */
export const requireOwnerPlayIntegrity = async (req, res, next) => {
  try {
    const user = await User.findById(req.auth.id)
      .select("enrollmentMode linkedDeviceId tenantId")
      .lean();

    // Preserve each existing endpoint's response for a missing borrower.
    if (!user) return next();

    if (isRunningDevice(user)) {
      const error = runningModeError("Play Integrity is not supported for running-device enrollment");
      return sendError(res, error.statusCode, error.message, { code: error.code });
    }

    // Check the linked device too, so a stale borrower mode cannot enable Play Integrity.
    if (user.linkedDeviceId) {
      const device = await Device.findOne({
        _id: user.linkedDeviceId,
        userId: user._id,
        tenantId: user.tenantId
      }).select("enrollmentMode").lean();
      if (isRunningDevice(device)) {
        const error = runningModeError("Play Integrity is not supported for running-device enrollment");
        return sendError(res, error.statusCode, error.message, { code: error.code });
      }
    }

    return next();
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};
