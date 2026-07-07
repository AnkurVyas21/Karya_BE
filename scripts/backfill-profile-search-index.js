require('dotenv').config();

const mongoose = require('mongoose');
const ProfessionalProfile = require('../src/models/ProfessionalProfile');
const { buildProfileSearchIndex } = require('../src/utils/searchIndexUtils');

const batchSize = Math.max(Number(process.env.SEARCH_INDEX_BACKFILL_BATCH_SIZE || 500), 1);

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });

  let processed = 0;
  let updated = 0;
  let lastId = null;

  while (true) {
    const query = lastId ? { _id: { $gt: lastId } } : {};
    const profiles = await ProfessionalProfile.find(query)
      .sort({ _id: 1 })
      .limit(batchSize)
      .lean();

    if (profiles.length === 0) {
      break;
    }

    const operations = profiles.map((profile) => ({
      updateOne: {
        filter: { _id: profile._id },
        update: {
          $set: {
            searchIndex: buildProfileSearchIndex(profile)
          }
        }
      }
    }));

    if (operations.length > 0) {
      const result = await ProfessionalProfile.bulkWrite(operations, { ordered: false });
      updated += result.modifiedCount || 0;
    }

    processed += profiles.length;
    lastId = profiles[profiles.length - 1]._id;
    console.log(`Backfilled search index for ${processed} profiles...`);
  }

  console.log(`Done. Processed ${processed} profiles, updated ${updated}.`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
