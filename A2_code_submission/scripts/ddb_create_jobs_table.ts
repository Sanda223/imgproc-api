import 'dotenv/config';
import { DynamoDBClient, CreateTableCommand, ResourceInUseException } from "@aws-sdk/client-dynamodb";

const REGION = process.env.AWS_REGION || "ap-southeast-2";
const qutUser = process.env.QUT_USERNAME!; 
const tableName = "a2-n11594128-imgproc-jobs"; 

async function main() {
  const ddb = new DynamoDBClient({ region: REGION });

  const cmd = new CreateTableCommand({
    TableName: tableName,
    AttributeDefinitions: [
      { AttributeName: "qut-username", AttributeType: "S" },
      { AttributeName: "sk",            AttributeType: "S" }, // sort key
    ],
    KeySchema: [
      { AttributeName: "qut-username", KeyType: "HASH" },  // partition key
      { AttributeName: "sk",            KeyType: "RANGE" }, // sort key
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 },
  });

  try {
    await ddb.send(cmd);
    console.log(`Created table ${tableName}`);
  } catch (e: any) {
    if (e instanceof ResourceInUseException) {
      console.log(`Table ${tableName} already exists — ok`);
    } else {
      console.error(e);
      process.exit(1);
    }
  }
}

main();