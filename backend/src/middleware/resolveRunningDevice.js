import { isRunningDevice } from "../constants/enrollmentModes.js";
import { Device } from "../models/Device.js";
import { User } from "../models/User.js";
import { sendError } from "../utils/apiResponse.js";

const RUNNING_PRE_ACTIVATION_PATHS = new Set([
  "/consent/accept",
  "/device/register"
]);

/** Keep the existing borrower JWT convention while selecting the linked running device. */
export const resolveRunningDevice = async (req, res, next) => {
  try {
    const user = await User.findById(req.auth.id)
      .select("linkedDeviceId tenantId enrollmentMode isDeviceLinked")
      .lean();
    if (!user || !isRunningDevice(user)) return next();
    if (!user.linkedDeviceId) {
      if (user.isDeviceLinked) return sendError(res, 403, "Linked running device was not found");
      if (RUNNING_PRE_ACTIVATION_PATHS.has(req.path)) return next();
      return sendError(res, 403, "Running device is not enrolled");
    }
    const device = await Device.findOne({
      _id: user.linkedDeviceId,
      userId: user._id,
      tenantId: user.tenantId,
      enrollmentMode: "RUNNING_APP"
    }).lean();
    if (!device) return sendError(res, 403, "Linked running device was not found");
    req.runningDevice = device;
    return next();
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};
