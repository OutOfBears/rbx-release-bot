const redis = require("redis");
const pino = require("pino");

require("dotenv").config();

const logger = pino({
  transport: {
    target: "pino-pretty",
  },
});

const client = redis.createClient({
  url: process.env.REDIS_URL,
});

const webhooks = Object.entries(process.env)
  .filter((key) => {
    return key[0].startsWith("DISCORD_WEBHOOK");
  })
  .map((value) => value[1]);

function removeHtmlTags(str) {
  return str.replace(/<[^>]*>/g, "");
}

function codify(type, content) {
  return `\`\`\`${type}\n${content}\n\`\`\``;
}

function formatData(data) {
  const improvements = [];
  const fixes = [];

  data.modified.forEach((value) => {
    const realValue = value.value;
    const oldStatus = value.oldStatus;

    if (realValue.type === "Improvements") {
      improvements.push(
        `* [${oldStatus} -> ${realValue.status}] ${removeHtmlTags(
          realValue.content
        )}`
      );
    } else if (realValue.type === "Fixes") {
      fixes.push(
        `* [${oldStatus} -> ${realValue.status}] ${removeHtmlTags(
          realValue.content
        )}`
      );
    }
  });

  data.added.forEach((value) => {
    if (value.type === "Improvements") {
      improvements.push(`+ [${value.status}] ${removeHtmlTags(value.content)}`);
    } else if (value.type === "Fixes") {
      fixes.push(`+ [${value.status}] ${removeHtmlTags(value.content)}`);
    }
  });

  data.removed.forEach((value) => {
    if (value.type === "Improvements") {
      improvements.push(`- [${value.status}] ${removeHtmlTags(value.content)}`);
    } else if (value.type === "Fixes") {
      fixes.push(`- [${value.status}] ${removeHtmlTags(value.content)}`);
    }
  });

  return { improvements, fixes };
}

async function postToChannel(webhookUrl, data) {
  const release = data.release;
  const formatted = formatData(data.diffs);
  const fields = [];

  if (formatted.improvements.length > 0) {
    fields.push({
      name: "Improvements",
      value: codify("diff", formatted.improvements.join("\n")),
    });
  }

  if (formatted.fixes.length > 0) {
    fields.push({
      name: "Fixes",
      value: codify("diff", formatted.fixes.join("\n")),
    });
  }

  if (fields.length === 0) {
    return;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: null,
      embeds: [
        {
          title: `** Release ${release}**`,
          description: `Roblox has pushed some changes to the release notes! check them out here or go and see the [version notes](https://github.com/OutOfBears/rbx-release-tracker/blob/main/docs/release-${release}.md)`,
          color: 16748288,
          fields: fields,
        },
      ],
      username: "RBX Release Tracker",
      avatar_url: "https://i.imgur.com/YWC5JA3.png",
      attachments: [],
      flags: 4096,
    }),
  });

  if (!response.ok) {
    throw new Error(`Error posting to webhook: ${response.statusText}`);
  }
}

async function run() {
  await client.connect();
  logger.info("connected to Redis");

  await client.subscribe("update", (message) => {
    const data = JSON.parse(message);
    webhooks.forEach((webhook) => {
      postToChannel(webhook, data).catch((err) => {
        logger.error(err);
      });
    });
  });

  logger.info("subscribed to update channel");
}

if (!process.env.REDIS_URL) {
  logger.error("No Redis URL provided");
  process.exit(-1);
}

if (webhooks.length < 1) {
  logger.error("No webhooks provided");
  process.exit(-1);
}

run().catch((err) => {
  logger.error(err);
  process.exit(-1);
});
