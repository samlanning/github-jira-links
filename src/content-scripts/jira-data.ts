import { ContentScriptMessage, JiraApiResponse } from '../shared/messages';

export interface JiraLink {
  name: string;
  url: string;
  status: string;
  statusColor: StatusColor;
}

export type JiraError = 'login-required' | 'unknown-error';

/**
 * Well-known status colors, as defined here:
 * - https://docs.atlassian.com/DAC/javadoc/jira/reference/com/atlassian/jira/issue/status/category/StatusCategory.html
 */
export const StatusColors = {
  'medium-gray': { bg: '#ccc', text: '#333' },
  'green': { bg: '#14892c', text: '#fff' },
  'yellow': { bg: '#ffd351', text: '#594300' },
  'brown': { bg: '#815b3a', text: '#fff' },
  'warm-red': { bg: '#d04437', text: '#fff' },
  'blue-gray': { bg: '#4a6785', text: '#fff' },
};

type StatusColor = keyof typeof StatusColors;

interface JiraSearchResponse {
  issues: {
    fields: {
      status: {
        name: string;
        statusCategory: {
          colorName: StatusColor;
        }
      }
    };
    key: string;
  }[];
}

/**
 * Map from JIRA URL -> Issue URL -> result
 *
 * page-local cache of jira issues to reduce the load of requests when navigating around github.
 * This only improves situations where no page reloads happen (i.e. when GitHub uses pushState).
 * Users can still reload the page to refresh the data from Jira.
 */
const cache = new Map<string, Map<string, JiraLink[]>>();

export async function loadJiraData(issueUrl: URL, jiraUrl: string): Promise<JiraLink[] | JiraError> {
  let jiraMap = cache.get(jiraUrl);
  if (!jiraMap) {
    jiraMap = new Map<string, JiraLink[]>();
    cache.set(jiraUrl, jiraMap);
  }
  const issueLinks = jiraMap.get(issueUrl.href);
  if (issueLinks) return issueLinks;
  console.log('loadJiraData', issueUrl, jiraUrl);
  // TODO
  const url = `${jiraUrl}/rest/api/2/search?jql=text%20~%20"${encodeURIComponent(issueUrl.href)}"`;
  console.log(url);
  const msg: ContentScriptMessage = {
    type: 'jira-api-call', url
  };
  const response: JiraApiResponse = await new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
  if (response.type === 'error') {
    return response.status === 401 ? 'login-required' : 'unknown-error';
  }
  const json = JSON.parse(response.data) as JiraSearchResponse;
  const result: JiraLink[] = [];
  for (const issue of json.issues) {
    result.push({
      name: issue.key,
      url: `${jiraUrl}/browse/${issue.key}`,
      status: issue.fields.status.name,
      statusColor: issue.fields.status.statusCategory.colorName
    });
  }
  jiraMap.set(issueUrl.href, result);
  return result;
}

export async function isLoggedIn(jiraUrl: string): Promise<boolean> {
  const url = `${jiraUrl}/rest/api/2/myself`;
  const msg: ContentScriptMessage = {
    type: 'jira-api-call', url
  };
  const response: JiraApiResponse = await new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
  if (response.type === 'error') {
    if (response.status === 401) return false;
    throw new Error('unrecognized error');
  } else {
    return true;
  }
}
