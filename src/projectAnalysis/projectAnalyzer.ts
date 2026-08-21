import { scanProject } from './scanner';
import { detectProject } from './detector';
import { ProjectAnalysis } from './types';

export async function analyzeProject(
    rootPath: string
): Promise<ProjectAnalysis> {

    const scanned = await scanProject(rootPath);

    const detected = await detectProject(rootPath);

    const sourceFiles =
        scanned.files.filter(
            file => file.category === 'source'
        );

    const testFiles =
        scanned.files.filter(
            file => file.category === 'test'
        );

    const configFiles =
        scanned.files.filter(
            file => file.category === 'config'
        );

    const assetFiles =
        scanned.files.filter(
            file => file.category === 'asset'
        );

    return {
        rootPath,

        projectType:
            detected.projectType,

        framework:
            detected.framework,

        frameworkVersion:
            detected.frameworkVersion,

        language:
            detected.language,

        technologies:
            detected.technologies,

        files:
            scanned.files,

        directories:
            scanned.directories,

        entryPoints:
            detectEntryPoints(
                sourceFiles,
                detected.projectType
            ),

        configs:
            configFiles.map(
                file => file.path
            ),

        tests:
            testFiles.map(
                file => file.path
            ),

        assets:
            assetFiles.map(
                file => file.path
            )
    };
}

function detectEntryPoints(
    files: ProjectAnalysis['files'],
    projectType: ProjectAnalysis['projectType']
): string[] {

    const candidates = files.filter(
        file => {
            const normalized =
                file.path.toLowerCase();

            if (
                projectType === 'nextjs'
            ) {
                return (
                    normalized.endsWith('/page.tsx') ||
                    normalized.endsWith('/page.ts') ||
                    normalized.endsWith('/page.jsx') ||
                    normalized.endsWith('/page.js') ||
                    normalized.endsWith('/layout.tsx') ||
                    normalized.endsWith('/layout.ts')
                );
            }

            return (
                normalized.endsWith('/index.ts') ||
                normalized.endsWith('/index.tsx') ||
                normalized.endsWith('/index.js') ||
                normalized.endsWith('/index.jsx') ||
                normalized.endsWith('/index.php')
            );
        }
    );

    return candidates.map(
        file => file.path
    );
}