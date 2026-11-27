// Creates AWS SDK clients once. With AWS_ENDPOINT_URL=http://localhost:4566 they talk to Floci;
// without it they talk to real AWS. The code is identical either way.
const { S3Client } = require('@aws-sdk/client-s3');
const { SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');
const { CloudWatchClient } = require('@aws-sdk/client-cloudwatch');
const config = require('../config');

const base = { region: config.aws.region, endpoint: config.aws.endpoint };

let s3; let secrets; let cloudwatch;
module.exports = {
  // forcePathStyle: Floci (like LocalStack) serves buckets as http://localhost:4566/<bucket>/<key>
  s3: () => (s3 = s3 || new S3Client({ ...base, forcePathStyle: Boolean(config.aws.endpoint) })),
  secrets: () => (secrets = secrets || new SecretsManagerClient(base)),
  cloudwatch: () => (cloudwatch = cloudwatch || new CloudWatchClient(base)),
};
