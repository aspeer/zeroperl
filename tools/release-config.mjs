import {readFileSync} from 'node:fs';
import {versionParts} from './release.mjs';
const config=JSON.parse(readFileSync('release/versions.json','utf8'));
versionParts(config.version);
if(!Array.isArray(config.perlVersions) || !config.perlVersions.length || new Set(config.perlVersions).size !== config.perlVersions.length || !config.perlVersions.every(v => config.supportedPerlVersions.includes(v) && /^5\.(18\.4|36\.3|44\.0)$/.test(v))) throw Error('Invalid release Perl selection');
console.log(`perls=${JSON.stringify(config.perlVersions)}`);
