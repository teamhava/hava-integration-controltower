import { OrganizationsClient,ListRootsCommand, ListAccountsForParentCommand, ListOrganizationalUnitsForParentCommand } from "@aws-sdk/client-organizations";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { IAMClient, GetRoleCommand, NoSuchEntityException, CreateRoleCommand } from "@aws-sdk/client-iam";

const AccountBlacklist = process.env.HAVA_BLACKLIST_ACCOUNT_IDS.split(',').map((x) => x.toLowerCase().trim());
const OrgUnitBlacklist = process.env.HAVA_BLACKLIST_OU_IDS.split(',').map((x)=> x.toLowerCase().trim());
const HavaAPIEndpoint = process.env.HAVA_ENDPOINT || "https://api.hava.io";

export const handler = async (event) => {
  
  const havaAccounts = await getHavaAccounts()
  const parsedHavaAccounts = await parseHavaAccounts(havaAccounts);
  
  console.log(parsedHavaAccounts);
  
  const root = await getAWSRootOU()
  const awsAccounts = new Array();
  
  await getAWSOrgChildren(root.Id, awsAccounts);
  
  console.log(awsAccounts);
  
  
  const toDelete = await getAccountsToDelete(parsedHavaAccounts, awsAccounts);
  
  console.log("Hava accounts to delete");
  console.log(toDelete);
  
  //await deleteHavaAccounts(toDelete);
  
  const toAdd = await getAccountsToAdd(parsedHavaAccounts, awsAccounts);
  
  console.log("Aws account to add:")
  console.log(toAdd);
  
  //await addHavaAccounts(toAdd);
  
  await createHavaRole(toAdd);
  
  return "Wooo";
};

const getAccountsToDelete = async (havaAccounts, awsAccounts) => {
  const toDelete = new Array();
  
  for (let i = 0; i < havaAccounts.length; i++) {
    let match = false;
    for (let x = 0; x < awsAccounts.length; x++) {
      if (havaAccounts[i].awsAccountId === awsAccounts[x].Id) {
        match = true;
        break;
      }
    }
    
    if (!match) {
      toDelete.push(havaAccounts[i])
    }
  }
  
  return toDelete;
}

const getAccountsToAdd = async (havaAccounts, awsAccounts) => {
  const toAdd = new Array();
  
  for (let i = 0; i < awsAccounts.length; i++) {
    let match = false;
    for (let x = 0; x < havaAccounts.length; x++) {
      if(awsAccounts[i].Id === havaAccounts[x].awsAccountId) {
        match = true;
        break;
      }
    }
    if (!match) {
      toAdd.push(awsAccounts[i]);
    }
  }
  
  return toAdd;
}

// This always gets the first root OU as there should always only be 1
const getAWSRootOU = async () => {
  const client = new OrganizationsClient();
  const input = {
    "MaxResult": Number("1")
  }
  const command = new ListRootsCommand(input);
  const response = await client.send(command)
  
  if (response.Roots.length > 0) {
    return response.Roots[0]
  }
  
  throw "Could not find root OU?!"
  
}

const getAWSOrgChildren = async (ouId, accounts) => {
  // Stop parsing branch if org unit is blacklisted
  if (OrgUnitBlacklist.includes(ouId.toLowerCase())) {
    return;
  }
  
  const childAccounts = await getAWSChildAccounts(ouId, null);
  
  // Clear out all blacklisted accounts
  for(let i=0;i<childAccounts.length;i++) {
    let x = childAccounts[i];
    if (x.Status.toLowerCase() !== "active" ||AccountBlacklist.includes(x.Id.toLowerCase())) {
      continue;
    }
    accounts.push({
      "Name": x.Name,
      "Id": x.Id
    });
  }
  
  const childOus = await getAWSChildOus(ouId, null);
  for(let i=0;i<childOus.length;i++){
    await getAWSOrgChildren(childOus[i].Id, accounts)
  }
}

const getAWSChildAccounts = async (ouId, nextToken) => {
  const client = new OrganizationsClient();
  const input = {
    "ParentId": ouId,
    "MaxResults": 20,
    "NextToken": nextToken
  }
  
  const command = new ListAccountsForParentCommand(input);
  const result = await client.send(command);
  
  
  if (result.NextToken) {
    // console.log("Found nextToken, diving deeper!")
    const paginatedResult = await getAWSChildAccounts(ouId, result.NextToken)
    result.Accounts = result.Accounts.concat(paginatedResult.Accounts)
  }
  return result.Accounts
}

const getAWSChildOus = async(ouId, nextToken) => {
  const client = new OrganizationsClient();
  const input = {
    "ParentId": ouId,
    "MaxResults": 20,
    "NextToken": nextToken
  }
  
  const command = new ListOrganizationalUnitsForParentCommand(input);
  const result = await client.send(command);
  
  
  if (result.NextToken) {
    // console.log("Found nextToken, diving deeper!")
    const paginatedResult = await getAWSChildOus(ouId, result.NextToken)
    result.OrganizationalUnits.concat(paginatedResult.OrganizationalUnits)
  }
  return result.OrganizationalUnits
}

const getAPIKey = async () => {
  const client = new SSMClient();
  const input = {
    Name: process.env.HAVA_TOKEN_PATH,
    WithDecryption: true,
  };
  
  const command = new GetParameterCommand(input)

  const response = await client.send(command);

  return response.Parameter.Value;
};

const parseHavaAccounts = async (accounts) => {
  const accountIds = new Array();
  
  for (let i = 0; i < accounts.length; i++) {
    let accountNo = accounts[i].info.split(':')[4];
    if (!isNaN(accountNo)) {
      accountIds.push({
        "id": accounts[i].id, 
        "awsAccountId": accountNo,
        "name": accounts[i].name
      });
    }
  }
  
  return accountIds;
}

const getHavaAccounts = async (token) => {
  const API_KEY = await getAPIKey();
  
  let url = "https://api.hava.io/sources?page_size=50"
  
  if (token) {
    url += "&token=" + token
  }
  
  var options = {
    headers: {
      // "Content-Type": "application/json",
      'Authorization': "Bearer " + API_KEY
    }
  }
  
  const res = await fetch(url, options);
  
  if (res.status >= 500) {
    throw "Server broke....that shouldn't happen. Try again later"
  }

  if (res.status === 401) {
    throw "Authnetication error, API key set correctly?"
  }
  
  const jsonResult = await res.json();
  
  // only care about cross account roles for this
  let accounts = jsonResult.results.filter((x) => x.type === 'Sources::AWS::CrossAccountRole');
  
  if (jsonResult.next_page_token) {
    const nextPage = await getHavaAccounts(jsonResult.next_page_token) 
    
    accounts = accounts.concat(nextPage);
  }
  
  return accounts;
}

const deleteHavaAccounts = async (accounts) => {
  const API_KEY = await getAPIKey();
  
  const options = {
    method: "DELETE",
    headers: {
      'Authorization': "Bearer " + API_KEY
    }
  }
  
  for (let i = 0; i < accounts.length; i++) {
    const url = "https://api.hava.io/sources/" + accounts[i].id
    const res = await fetch(url, options)
    
    if (res.status >= 500) {
      throw "Server broke....that shouldn't happen. Try again later"
    }
    
    if (res.status === 401) {
      throw "Authentication error, API key set correctly?"
    }
    
    if (res.status === 404) {
      console.warn(`Account not found: ${accounts[i].name}. Assumed to be deleted by other process`);
    }
  }
}

const addHavaAccounts = async (awsAccounts) => {
  const API_KEY = await getAPIKey();
  const externalId = '0934086b5ab9970205878266249aebd9';
  const url = HavaAPIEndpoint + "/sources"
  
  console.log(url);
  
  for (let i=0; i<awsAccounts.length;i++) {
    const arn = "arn:aws:iam::" + awsAccounts[i].Id + ":role/HavaRo";
    const body = {
      "name": awsAccounts[i].Name,
      "type": "AWS::CrossAccountRole",
      "external_id": externalId,
      "role_arn": arn
    }
    
    const options = {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        'Authorization': "Bearer " + API_KEY,
        'Content-Type': 'application/json'
      }
    }
    
    const res = await fetch(url, options);
    
    if (res.status >= 500) {
      throw "Server broke....that shouldn't happen. Try again later"
    }
    
    if (res.status === 401) {
      throw "Authentication error, API key set correctly?"
    }
    
    if (res.status === 422) {
      console.warn(`Account '${awsAccounts[i].Id}' is already added`)
    }
  }
}

const createHavaRole = async (awsAccounts) => {
  
  console.log("adding roles");
  
  for (let i=0; i<awsAccounts.length; i++) {
    
    let role;
    
    try {
      role = await assumeRole(awsAccounts[i].Id);
    } catch (e) {
      console.warn(`Was not able assume role in account ${awsAccounts[i].Id}. Has it not been onboarded to ControlTower?`);
      continue;
    }
    
    const client = new IAMClient({
      credentials: {
        accessKeyId: role.Credentials.AccessKeyId,
        secretAccessKey: role.Credentials.SecretAccessKey,
        sessionToken: role.Credentials.SessionToken
      }
    });
    const input = {
      RoleName: "HavaRO"
    }
    
    const command = new GetRoleCommand(input);
    try {
      const res = await client.send(command);
      console.log(res);
    } catch (e) {
      if (e instanceof NoSuchEntityException) {
        console.log("Createing role");
      } else {
        throw e
      }
    }
  }
}

const createRORoleInAwsAccount = async (assumedRole) => {
  const client = new IAMClient({
    credentials: {
      accessKeyId: assumedRole.Credentials.AccessKeyId,
      secretAccessKey: assumedRole.Credentials.SecretAccessKey,
      sessionToken: assumedRole.Credentials.SessionToken
    }
  });
  
  const assumeRolePolicy = {
    
  }
  
  const input = {
    "AssumerolePolicyDocument": JSON.stringify(assumeRolePolicy),
    "Path": "/",
    "RoleName": "HavaRO",
    "Description": "Read only role for Hava.io"
  }
  
  const command = new CreateRoleCommand(input);
  const res = await client.send(command);
  
  console.log(res);
}

const assumeRole = async (awsAccountId) => {
  const client = new STSClient();
  const input = {
    RoleArn: "arn:aws:iam::" + awsAccountId + ":role/AWSControlTowerExecution",
    RoleSessionName: "hava-session"
  }
  
  const command = new AssumeRoleCommand(input);
  const response = await client.send(command);
  
  return response;
}