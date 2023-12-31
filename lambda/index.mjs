import {
  OrganizationsClient,
  ListRootsCommand,
  ListAccountsForParentCommand,
  ListOrganizationalUnitsForParentCommand,
} from "@aws-sdk/client-organizations";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  IAMClient,
  GetRoleCommand,
  NoSuchEntityException,
  CreateRoleCommand,
  AttachRolePolicyCommand,
} from "@aws-sdk/client-iam";

const normalizeId = (id) => id.toLowerCase().trim();

const createLookup = (ids) => {
  const lookup = {};
  for (let i = 0, ii = ids.length; i < ii; i++) {
    lookup[ids[i]] = true;
  }
  return lookup;
};

const AccountBlocklist =
  (process.env.HAVA_BLOCKLIST_ACCOUNT_IDS || "").split(",").map(normalizeId);
const AccountBlocklistLookup = createLookup(AccountBlocklist);
const OrgUnitBlocklist =
  (process.env.HAVA_BLOCKLIST_OU_IDS || "").split(",").map(normalizeId);
const OrgUnitBlocklistLookup = createLookup(OrgUnitBlocklist);
const HavaAPIEndpoint =
  (process.env.HAVA_ENDPOINT || "https://api.hava.io").trim();
const HavaCARAccount = (process.env.HAVA_CAR_ACCOUNT || "281013829959").trim();
const ExternalId = (process.env.HAVA_EXTERNAL_ID || "").trim();
const TokenPath = (process.env.HAVA_TOKEN_PATH || "").trim();
const DryRun = (process.env.HAVA_DRY_RUN || "false").trim().toLowerCase() === "true";

export const handler = async () => {
  await validateConfig();

  if (DryRun) {
    console.log("Running in DryRun Mode, will not execute any write commands against AWS or Hava");
  }

  const havaAccounts = await getHavaAccounts();
  const parsedHavaAccounts = await parseHavaAccounts(havaAccounts);

  const root = await getAWSRootOU();
  const awsAccounts = new Array();

  console.log("Scanning organisation for accounts");
  await getAWSOrgChildren(root.Id, awsAccounts);

  const toDelete = await getAccountsToDelete(parsedHavaAccounts, awsAccounts);

  console.log((toDelete && toDelete.length) + " Hava accounts to delete:");
  console.log(toDelete);

  await deleteHavaAccounts(toDelete);

  const toAdd = await getAccountsToAdd(parsedHavaAccounts, awsAccounts);

  console.log((toAdd && toAdd.length) + " AWS accounts to add:");
  console.log(toAdd);

  const validAwsAccountsToAdd = await createHavaRole(toAdd);

  await addHavaAccounts(validAwsAccountsToAdd);

  return "Success";
};

const validateConfig = async () => {
  const errors = new Array();

  if (!HavaCARAccount || !HavaCARAccount.match(/\d{12,}/)) {
    errors.push(
      `Config Error: HAVA_CAR_ACCOUNT environment variable not a valid 12 digit number, is it set properly? Value: ${HavaCARAccount}`
    );
  }

  if (!ExternalId) {
    errors.push(
      "Config Error: HAVA_EXTERNAL_ID environment variable is missing"
    );
  }

  if (!TokenPath) {
    errors.push(
      "Config Error: HAVA_TOKEN_PATH environment variable is missing"
    );
  }

  if (errors.length > 0) {
    errors.forEach((err) => console.error(err));
    throw "Configuration Error, see error messages in log";
  }
};

const getAccountsToDelete = async (havaAccounts, awsAccounts) => {
  const toDelete = [];
  const awsAccountsLookup = {};
  for (let i = 0, ii = awsAccounts.length; i < ii; i++) {
    const awsAccount = awsAccounts[i];
    awsAccountsLookup[awsAccount.Id] = true;
  }
  for (let i = 0, ii = havaAccounts.length; i < ii; i++) {
    const havaAccount = havaAccounts[i];
    if (!awsAccountsLookup[havaAccount.awsAccountId])
      toDelete.push(havaAccount);
  }
  return toDelete;
};

const getAccountsToAdd = async (havaAccounts, awsAccounts) => {
  const toAdd = [];
  const havaAccountsLookup = {};
  for (let i = 0, ii = havaAccounts.length; i < ii; i++) {
    const havaAccount = havaAccounts[i];
    havaAccountsLookup[havaAccount.awsAccountId] = true;
  }
  for (let i = 0, ii = awsAccounts.length; i < ii; i++) {
    const awsAccount = awsAccounts[i];
    if (!havaAccountsLookup[awsAccount.Id]) toAdd.push(awsAccount);
  }
  return toAdd;
};

// This always gets the first root OU as there should always only be 1
const getAWSRootOU = async () => {
  const client = new OrganizationsClient();
  const input = {
    MaxResult: Number("1"),
  };
  const command = new ListRootsCommand(input);
  const response = await client.send(command);

  if (response.Roots.length > 0) {
    return response.Roots[0];
  }

  throw "Could not find root OU?!";
};

const getAWSOrgChildren = async (ouId, accounts) => {
  
  console.log(`ou: ${ouId}`);
  // Stop parsing branch if org unit is blacklisted
  if (OrgUnitBlocklistLookup[ouId.toLowerCase()]) {
    console.log('Skipping ou as it was found in blocklist');
    return;
  }

  const childAccounts = await getAWSChildAccounts(ouId, null);
  console.log(`accounts found: ${childAccounts.length}`)
  // Clear out all blacklisted accounts
  for (let i = 0, ii = childAccounts.length; i < ii; i++) {
    const childAccount = childAccounts[i];
    if (
      !childAccount ||
      childAccount.Status.toLowerCase() !== "active" ||
      AccountBlocklistLookup[childAccount.Id.toLowerCase()]
    ) {
      continue;
    }
    accounts.push({
      Name: childAccount.Name,
      Id: childAccount.Id,
    });
  }

  const childOus = await getAWSChildOus(ouId, null);
  for (let i = 0, ii = childOus.length; i < ii; i++) {
    await getAWSOrgChildren(childOus[i].Id, accounts);
  }
};

const getAWSChildAccounts = async (ouId, nextToken) => {
  const client = new OrganizationsClient();
  const input = {
    ParentId: ouId,
    MaxResults: 20,
    NextToken: nextToken,
  };

  const command = new ListAccountsForParentCommand(input);
  const result = await client.send(command);

  if (result.NextToken) {
    // console.log("Found nextToken, diving deeper!")
    const paginatedResult = await getAWSChildAccounts(ouId, result.NextToken);
    result.Accounts = result.Accounts.concat(paginatedResult);
  }
  return result.Accounts;
};

const getAWSChildOus = async (ouId, nextToken) => {
  const client = new OrganizationsClient();
  const input = {
    ParentId: ouId,
    MaxResults: 20,
    NextToken: nextToken,
  };

  const command = new ListOrganizationalUnitsForParentCommand(input);
  const result = await client.send(command);

  if (result.NextToken) {
    // console.log("Found nextToken, diving deeper!")
    const paginatedResult = await getAWSChildOus(ouId, result.NextToken);
    result.OrganizationalUnits = result.OrganizationalUnits.concat(paginatedResult);
  }
  return result.OrganizationalUnits;
};

const getAPIKey = async () => {
  const client = new SSMClient();
  const input = {
    Name: TokenPath,
    WithDecryption: true,
  };
  const command = new GetParameterCommand(input);
  const response = await client.send(command);
  return response.Parameter.Value;
};

const parseHavaAccounts = async (accounts) => {
  const accountIds = new Array();

  for (let i = 0, ii = accounts.length; i < ii; i++) {
    const account = accounts[i];
    let accountNo = account.info.split(":")[4];

    // filter out accounts with invalid account numbers
    if (accountNo.match(/\d{12,}/)) {
      accountIds.push({
        id: account.id,
        awsAccountId: accountNo,
        name: account.name,
        roleArn: account.info
      });
    }
  }

  return accountIds;
};

const getHavaAccounts = async (token) => {
  const API_KEY = await getAPIKey();

  const url = token
    ? `https://api.hava.io/sources?page_size=50&token=${token}`
    : "https://api.hava.io/sources?page_size=50";

  var options = {
    headers: {
      // "Content-Type": "application/json",
      Authorization: "Bearer " + API_KEY,
    },
  };

  const res = await fetch(url, options);

  if (res.status >= 500) {
    throw "Server broke....that shouldn't happen. Try again later";
  }

  if (res.status === 401) {
    throw "Authnetication error, API key set correctly?";
  }

  const jsonResult = await res.json();

  // only care about cross account roles for this
  let accounts = jsonResult.results.filter(
    (x) => x.type === "Sources::AWS::CrossAccountRole",
  );

  if (jsonResult.next_page_token) {
    const nextPage = await getHavaAccounts(jsonResult.next_page_token);

    accounts = accounts.concat(nextPage);
  }

  return accounts;
};

const deleteHavaAccounts = async (accounts) => {
  const API_KEY = await getAPIKey();

  const options = {
    method: "DELETE",
    headers: {
      Authorization: "Bearer " + API_KEY,
    },
  };

  for (let i = 0, ii = accounts.length; i < ii; i++) {
    const account = accounts[i];

    if (DryRun) {
      console.log(`DryRun: Account '${account.name}(${account.id})' deleted`)
      continue;
    }

    const url = "https://api.hava.io/sources/" + account.id;
    const res = await fetch(url, options);

    if (res.status >= 500) {
      throw "Server broke....that shouldn't happen. Try again later";
    } else if (res.status === 401) {
      throw "Authentication error, API key set correctly?";
    } else if (res.status === 404) {
      console.warn(
        `Account not found: '${account.name}(${account.id})'. Assumed to be deleted by other process`,
      );
    } else {
      console.log(`Account '${account.name}(${account.id})' deleted`);
    }
  }
};

const addHavaAccounts = async (awsAccounts) => {
  console.log("Adding AWS Accounts to Hava");

  if (awsAccounts.length === 0) {
    console.log("No accounts to add");
    return;
  }

  const API_KEY = await getAPIKey();
  const url = HavaAPIEndpoint + "/sources";

  for (let i = 0, ii = awsAccounts.length; i < ii; i++) {
    const awsAccount = awsAccounts[i];

    if (DryRun) {
      console.log(`DryRun: Added account '${awsAccount.Name}(${awsAccount.Id})' to Hava`)
      continue;
    }

    const arn = "arn:aws:iam::" + awsAccount.Id + ":role/HavaRO";
    const body = {
      name: awsAccount.Name,
      type: "AWS::CrossAccountRole",
      external_id: ExternalId,
      role_arn: arn,
    };

    const options = {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        Authorization: "Bearer " + API_KEY,
        "Content-Type": "application/json",
      },
    };

    const res = await fetch(url, options);

    if (res.status >= 500) {
      throw "Server broke....that shouldn't happen. Try again later";
    } else if (res.status === 401) {
      throw "Authentication error, API key set correctly?";
    } else if (res.status === 422) {
      if(res.statusText === "Requires Payment") {
        throw "Hava account has run out of usable sources, please contact you billing admin to increase the number of available sources"
      }
      console.warn(
        `Account '${awsAccount.Name}(${awsAccount.Id})' is already added`,
      );
    } else {
      console.log(
        `Added account '${awsAccount.Name}(${awsAccount.Id})' to Hava`,
      );
    }
  }
};

const createHavaRole = async (awsAccounts) => {
  const validAccounts = new Array();

  console.log("Adding Hava ReadOnly role to AWS accounts");

  for (let i = 0, ii = awsAccounts.length; i < ii; i++) {
    const awsAccount = awsAccounts[i];
    let role;

    try {
      role = await assumeRole(awsAccount.Id);
    } catch (e) {
      console.warn(
        `Was not able assume role in account '${awsAccount.Name}(${awsAccount.Id})'. Has it not been onboarded to ControlTower?`,
      );
      continue;
    }

    if (DryRun) {
      console.log(`DryRun: Creating role in aws account: ${awsAccount.Name}(${awsAccount.Id})`);
      validAccounts.push(awsAccount);
      continue;
    }

    const client = new IAMClient({
      credentials: {
        accessKeyId: role.Credentials.AccessKeyId,
        secretAccessKey: role.Credentials.SecretAccessKey,
        sessionToken: role.Credentials.SessionToken,
      },
    });
    const input = {
      RoleName: "HavaRO",
    };

    const command = new GetRoleCommand(input);
    try {
      await client.send(command);
    } catch (e) {
      if (e instanceof NoSuchEntityException) {
        console.log(
          `Creating role in aws account: ${awsAccount.Name} (${awsAccount.Id})`,
        );
        createRORoleInAwsAccount(client);
      } else {
        throw e;
      }
    }

    validAccounts.push(awsAccount);
  }

  return validAccounts;
};

const createRORoleInAwsAccount = async (iamClient) => {
  const assumeRolePolicy = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: "sts:AssumeRole",
        Principal: {
          AWS: HavaCARAccount,
        },
        Condition: {
          StringEquals: {
            "sts:ExternalId": ExternalId,
          },
        },
      },
    ],
  };

  const createInput = {
    AssumeRolePolicyDocument: JSON.stringify(assumeRolePolicy),
    RoleName: "HavaRO",
    Description: "Read only role for Hava.io",
  };

  const createCommand = new CreateRoleCommand(createInput);
  const createRes = await iamClient.send(createCommand);

  const attachInput = {
    RoleName: "HavaRO",
    PolicyArn: "arn:aws:iam::aws:policy/ReadOnlyAccess",
  };

  const attachCommand = new AttachRolePolicyCommand(attachInput);
  const attachRes = await iamClient.send(attachCommand);
};

const assumeRole = async (awsAccountId) => {
  const client = new STSClient();
  const input = {
    RoleArn: "arn:aws:iam::" + awsAccountId + ":role/AWSControlTowerExecution",
    RoleSessionName: "hava-session",
  };

  const command = new AssumeRoleCommand(input);
  const response = await client.send(command);

  return response;
};
