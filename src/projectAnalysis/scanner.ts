import * as fs from 'fs/promises';
import * as path from 'path';
import { ProjectAnalysis, ProjectDirectory, ProjectFile } from './types';

export const IGNORED_DIRECTORIES = new Set([
    'node_modules',
    '.git',
    '.next',
    '.swc',
    'dist',
    'build',
    'out',
    'coverage',
    '.cache',
    '.turbo',
    '.nx',
    '.VSCodeCounter',
    'vendor'
]);

export async function scanProject(
    rootPath: string
): Promise<Omit<ProjectAnalysis, 'projectType' | 'framework' | 'frameworkVersion' | 'language' | 'technologies' | 'entryPoints' | 'configs' | 'tests' | 'assets'>> {
    const files: ProjectFile[] = [];
    const directories: ProjectDirectory[] = [];

    async function traverse(currentDir: string) {
        const entries = await fs.readdir(
            currentDir,
            { withFileTypes: true }
        );

        for (const entry of entries) {
            if (IGNORED_DIRECTORIES.has(entry.name)) {
                continue;
            }

            const fullPath = path.join(
                currentDir,
                entry.name
            );

            const relativePath = path
                .relative(rootPath, fullPath)
                .replace(/\\/g, '/');

            if (entry.isDirectory()) {
                directories.push({
                    path: relativePath,
                    name: entry.name
                });

                await traverse(fullPath);
                continue;
            }

            files.push({
                path: relativePath,
                name: entry.name,
                extension: path.extname(entry.name).toLowerCase(),
                category: classifyFile(entry.name, relativePath)
            });
        }
    }

    await traverse(rootPath);

    return {
        rootPath,
        files,
        directories
    };
}

function classifyFile(
    fileName: string,
    filePath: string
): ProjectFile['category'] {
    const lowerName = fileName.toLowerCase();
    const lowerPath = filePath.toLowerCase();

    if (
        lowerName.includes('.test.') ||
        lowerName.includes('.spec.') ||
        lowerPath.includes('__tests__')
    ) {
        return 'test';
    }

    if (
        [
            'package.json',
            'tsconfig.json',
            'next.config.js',
            'next.config.ts',
            'vite.config.ts',
            'webpack.config.js',
            'composer.json',
            'phpunit.xml'
        ].includes(lowerName)
    ) {
        return 'config';
    }

    if (
        [
            '.png',
            '.jpg',
            '.jpeg',
            '.gif',
            '.svg',
            '.webp',
            '.ico',
            '.mp4',
            '.mp3',
            '.woff',
            '.woff2'
        ].includes(
            path.extname(fileName).toLowerCase()
        )
    ) {
        return 'asset';
    }

    if (
        lowerName === 'readme.md' ||
        lowerName.endsWith('.md')
    ) {
        return 'documentation';
    }

    if (
        [
            '.ts',
            '.tsx',
            '.js',
            '.jsx',
            '.mjs',
            '.cjs',
            '.php',
            '.css',
            '.scss',
            '.less',
            '.html'
        ].includes(
            path.extname(fileName).toLowerCase()
        )
    ) {
        return 'source';
    }

    return 'other';
}