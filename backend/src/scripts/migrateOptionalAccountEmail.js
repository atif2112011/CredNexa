import mongoose from "mongoose";

import { connectDatabase } from "../config/database.js";

const run = async () => {
  await connectDatabase();

  const collection = mongoose.connection.collection("accounts");
  const indexes = await collection.indexes();
  const emailIndex = indexes.find((index) => index.key?.email === 1);

  if (emailIndex) {
    await collection.dropIndex(emailIndex.name);
    console.log(`Dropped existing account email index: ${emailIndex.name}`);
  }

  await collection.createIndex(
    { email: 1 },
    {
      unique: true,
      partialFilterExpression: { email: { $type: "string" } },
      name: "account_email_optional_unique"
    }
  );

  await collection.createIndex({ mobile: 1 }, { name: "account_mobile_lookup" });
  console.log("Account optional email indexes are ready");
};

run()
  .catch((error) => {
    console.error("Failed to migrate account email indexes", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
