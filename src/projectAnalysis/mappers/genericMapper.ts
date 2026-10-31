import * as fs from 'fs/promises';
import * as path from 'path';
import { ProjectAnalysis } from '../types';

export async function generateProjectMap(
    rootPath: string,
    analysis: ProjectAnalysis
): Promise<string> {

    const outputDirectory =
        path.join(
            rootPath,
            '.freecoder'
        );

    await fs.mkdir(
        outputDirectory,
        { recursive: true }
    );

    const outputPath =
        path.join(
            outputDirectory,
            'project-map.md'
        );

    const output =
        buildMarkdown(analysis);

    await fs.writeFile(
        outputPath,
        output,
        'utf8'
    );

    return outputPath;
}

function buildMarkdown(
    analysis: ProjectAnalysis
): string {

    const lines: string[] = [];

    lines.push(
        '# 🗺️ Project Overview'
    );

    lines.push('');

    lines.push(
        `Generated on: ${new Date().toLocaleString()}`
    );

    lines.push('');

    lines.push('## Project');

    lines.push('');

    lines.push(
        `- Type: **${analysis.projectType}**`
    );

    if (analysis.framework) {
        lines.push(
            `- Framework: **${analysis.framework}**`
        );
    }

    if (analysis.frameworkVersion) {
        lines.push(
            `- Version: **${analysis.frameworkVersion}**`
        );
    }

    if (analysis.language.length) {
        lines.push(
            `- Language: **${analysis.language.join(', ')}**`
        );
    }

    if (analysis.technologies.length) {
        lines.push('');
        lines.push('### Technologies');
        lines.push('');

        for (const technology of analysis.technologies) {
            lines.push(`- ${technology}`);
        }
    }

    lines.push('');

    lines.push('## Entry Points');

    lines.push('');

    for (const entryPoint of analysis.entryPoints) {
        lines.push(`- \`${entryPoint}\``);
    }

    lines.push('');

    lines.push('## Configuration');

    lines.push('');

    for (const config of analysis.configs) {
        lines.push(`- \`${config}\``);
    }

    lines.push('');

    lines.push('## Tests');

    lines.push('');

    lines.push(
        `Total test files: ${analysis.tests.length}`
    );

    lines.push('');

    lines.push('## Project Structure');

    lines.push('');

    for (const directory of analysis.directories) {
        const depth =
            directory.path.split('/').length;

        const indent =
            '  '.repeat(depth - 1);

        lines.push(
            `${indent}- 📂 ${directory.name}/`
        );
    }

    lines.push('');

    lines.push('## Source Files');

    lines.push('');

    const sourceFiles =
        analysis.files.filter(
            file =>
                file.category === 'source'
        );

    for (const file of sourceFiles) {
        lines.push(
            `- \`${file.path}\``
        );
    }

    lines.push('');

    return lines.join('\n');
}