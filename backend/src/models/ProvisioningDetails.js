import mongoose from "mongoose";

const provisioningDetailsSchema = new mongoose.Schema({
    adminComponentName: {
  type: String,
  required: true

},
adminPackageDownloadUrl:{
    type: String,
    required: true
},
adminSignatureChecksum:{
    type: String,
    required: true},
skipEncryption:{
    type: Boolean,
    default: false,
    required: true
}
},{timestamps: true});

export const ProvisioningDetails = mongoose.model("ProvisioningDetails", provisioningDetailsSchema);