// Publishes custom CloudWatch metrics (namespace FoodBank/Alerts).
// These feed the monitoring evidence: a graph of open alerts and an alarm on scan failures.
const { PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
const clients = require('./clients');
const config = require('../config');
const logger = require('../utils/logger');

async function putMetrics(metrics) {
  if (!config.aws.metricsEnabled) return;
  try {
    await clients.cloudwatch().send(new PutMetricDataCommand({
      Namespace: 'FoodBank/Alerts',
      MetricData: Object.entries(metrics).map(([MetricName, Value]) => ({
        MetricName, Value, Unit: 'Count', Timestamp: new Date(),
      })),
    }));
  } catch (err) {
    // Monitoring must never break the main feature, so we only log the failure.
    logger.error('METRIC_PUBLISH_FAILED', { message: err.message });
  }
}

module.exports = { putMetrics };
