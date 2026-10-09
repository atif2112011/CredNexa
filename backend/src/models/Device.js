import mongoose from "mongoose";
import { ENROLLMENT_MODES } from "../constants/enrollmentModes.js";

import { DEFAULT_DEVICE_RESTRICTIONS } from "../constants/deviceRestrictions.js";
import { DEVICE_POLICY_KEYS, DEVICE_STATES } from "../constants/deviceStates.js";

const deviceRestrictionValuesSchema = new mongoose.Schema(
  {
    dialer: { type: Boolean, default: false },
    camera: { type: Boolean, default: false },
    whatsapp: { type: Boolean, default: false },
    youtube: { type: Boolean, default: false },
    playStore: { type: Boolean, default: false }
  },
  { _id: false }
);

const deviceSecurityControlEntrySchema = new mongoose.Schema(
  {
    desiredBlocked: { type: Boolean, default: false },
    appliedBlocked: { type: Boolean, default: false },
    desiredVersion: { type: Number, default: 0 },
    appliedVersion: { type: Number, default: 0 },
    updatedAt: Date,
    appliedAt: Date,
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    }
  },
  { _id: false }
);

const locationSchema = new mongoose.Schema(
  {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    accuracyMeters: { type: Number, required: true },
    capturedAt: { type: Date, required: true },
    receivedAt: { type: Date, required: true }
  },
  { _id: false }
);

const deviceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true
    },
    imei: {
      type: String,
      required: true,
      index: true,
      trim: true
    },
    enrollmentMode: {
      type: String,
      enum: Object.values(ENROLLMENT_MODES),
      default: ENROLLMENT_MODES.DEVICE_OWNER_QR,
      index: true
    },
    identifierSource: {
      type: String,
      enum: ["DEVICE_REPORTED", "BORROWER_ENTERED"],
      default: "DEVICE_REPORTED"
    },
    // A request identifier deduplicates a lost activation response; it is not an auth credential.
    activationIdempotencyKey: String,
    capabilities: { type: mongoose.Schema.Types.Mixed, default: null },
    capabilitiesObservedAt: Date,
    capabilitiesReceivedAt: Date,
    locationConsentAccepted: { type: Boolean, default: false },
    imei2: {
      type: String,
      trim: true
    },
    deviceModel: String,
    manufacturer: String,
    androidVersion: String,
    appVersion: String,
    simInfo: {
      simOperator: String,
      simSerial: String,
      phoneNumber: String
    },
    fcmToken: String,
    fcmTokenUpdatedAt: Date,
    state: {
      type: String,
      enum: Object.values(DEVICE_STATES),
      default: DEVICE_STATES.ACTIVE
    },
    stateUpdatedAt: {
      type: Date,
      default: Date.now
    },
    stateUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    releaseRequestedAt: Date,
    releasedAt: Date,
    releaseCommandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeviceCommand"
    },
    tempUnlockExpiresAt: Date,
    graceReminderHistory: [
      {
        installmentId: {
          type: mongoose.Schema.Types.ObjectId
        },
        sentAt: {
          type: Date,
          required: true
        },
        graceStartedAt: Date,
        graceExpiresAt: Date,
        commandId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "DeviceCommand"
        }
      }
    ],
    currentPolicyKey: {
      type: String,
      enum: Object.values(DEVICE_POLICY_KEYS),
      default: DEVICE_POLICY_KEYS.EMI_PAID
    },
    currentPolicyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DevicePolicy"
    },
    desiredPolicyVersion: {
      type: Number,
      default: 0
    },
    lastAppliedPolicyVersion: {
      type: Number,
      default: 0
    },
    lastPolicyAppliedAt: Date,
    lastSeenAt: Date,
    lastSyncAt: Date,
    batteryLevel: Number,
    networkType: String,
    lastLocation: {
      type: locationSchema,
      default: null
    },
    restrictionState: {
      desired: {
        type: deviceRestrictionValuesSchema,
        default: () => ({ ...DEFAULT_DEVICE_RESTRICTIONS })
      },
      applied: {
        type: deviceRestrictionValuesSchema,
        default: () => ({ ...DEFAULT_DEVICE_RESTRICTIONS })
      },
      desiredVersion: {
        type: Number,
        default: 0
      },
      appliedVersion: {
        type: Number,
        default: 0
      },
      updatedAt: Date,
      appliedAt: Date,
      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Account"
      }
    },
    securityControlState: {
      factoryReset: {
        type: deviceSecurityControlEntrySchema,
        default: () => ({})
      },
      usbDebugging: {
        type: deviceSecurityControlEntrySchema,
        default: () => ({})
      },
      unknownAppInstalls: {
        type: deviceSecurityControlEntrySchema,
        default: () => ({})
      }
    },
    isOnline: {
      type: Boolean,
      default: false
    },
    isRooted: {
      type: Boolean,
      default: false
    },
    isTampered: {
      type: Boolean,
      default: false
    },
    deviceOwnerStatus: {
      type: String,
      enum: ["CONFIRMED", "UNKNOWN", "LOST", "RELEASED"],
      default: "UNKNOWN"
    },
    deviceSecurityState: {
      type: String,
      enum: ["HEALTHY", "WARNING", "LOCKED", "REMEDIATION", "COMPROMISED_PERMANENT", "WIPED_PENDING_REPROVISION"],
      default: "HEALTHY"
    },
    lastIntegrityCheckAt: Date,
    lastCleanIntegrityAt: Date,
    lastRiskAt: Date,
    integrityStaleAfter: Date,
    autoWipeEnabled: {
      type: Boolean,
      default: false
    },
    destructiveEnforcementEnabled: {
      type: Boolean,
      default: false
    },
    currentRiskIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "RiskFlag"
      }
    ],
    simChangedAt: Date
  },
  { timestamps: true }
);

deviceSchema.index({ tenantId: 1, enrollmentMode: 1, createdAt: -1 });

export const Device = mongoose.model("Device", deviceSchema);
