/** The GitHub organization that publishes every Cosmic Signature repository. */
export const GITHUB_ORGANIZATION_URL = 'https://github.com/PredictionExplorer';

const FRONTEND_DIRECTORY = 'Cosmic-Signature-frontend';

/** GitHub views for the main site's directory, source files and their revision history. */
export function frontendSourceUrl(view: 'tree' | 'blob' | 'commits', path = ''): string {
  const directory = `${GITHUB_ORGANIZATION_URL}/Cosmic-Signature-Monorepo/${view}/V4/${FRONTEND_DIRECTORY}`;
  return path ? `${directory}/${path}` : directory;
}

/** The image generation program shown on /code, as published on IPFS. */
export const IMAGE_GENERATION_IPFS_CID = 'QmWEao2HjCvyHJSbYnWLyZj8HfFardxzuNh7AUk1jgyXTm';
export const IMAGE_GENERATION_IPFS_URL = `https://ipfs.io/ipfs/${IMAGE_GENERATION_IPFS_CID}`;

/** Shared repository identities and destinations for the Source Code page. */
export const CODE_REPOSITORIES = [
  {
    id: 'frontend',
    name: FRONTEND_DIRECTORY,
    href: frontendSourceUrl('tree'),
  },
  {
    id: 'backend',
    name: 'augur-explorer',
    href: 'https://github.com/PredictionExplorer/augur-explorer',
  },
  {
    id: 'contracts',
    name: 'Cosmic-Signature',
    href: 'https://github.com/PredictionExplorer/Cosmic-Signature',
  },
  {
    id: 'images',
    name: 'CS-Image-Generation',
    href: 'https://github.com/PredictionExplorer/CS-Image-Generation',
  },
] as const;
