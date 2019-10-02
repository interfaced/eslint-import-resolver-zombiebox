const path = require('path');
const fs = require('fs');

let environment = null;
let aliasMap = new Map();
const cache = new Map();

const isLocalImport = (filename) =>
	filename.startsWith('./') ||
	filename.startsWith('../') ||
	filename.startsWith('/');

const resolveFile = (filepath) => {
	let stat;
	let resolvedPath = path.extname === '.js' ? filepath : filepath + '.js';

	if (cache.has(resolvedPath)) {
		return cache.get(resolvedPath);
	}

	try {
		stat = fs.statSync(resolvedPath);
	} catch (e) {
		// ignore
	}

	const report = stat && stat.isFile() ?
		{
			found: true,
			path: resolvedPath
		} :
		{
			found: false,
			path: null
		};

	cache.set(resolvedPath, report);
	return report;
};

const findPackageJson = (startLocation = process.cwd(), constraint = () => true) => {
	let cwd = startLocation;
	while (cwd !== '/') {
		const packageJsonPath = path.join(cwd, 'package.json');
		if (fs.existsSync(packageJsonPath)) {
			if (constraint(require(packageJsonPath))) {
				return packageJsonPath;
			}
		}

		cwd = path.dirname(cwd);
	}
	return null;
};

const constructAliasMap = (config) => {
	switch (environment.kind) {
		case 'zombiebox': {
			aliasMap.set('zb', path.join(path.dirname(environment.packageJsonPath), environment.packageJson.module || 'zb'));
			break;
		}
		case 'addon': {
			const Addon = require(path.dirname(environment.packageJsonPath));
			const addon = new Addon();

			aliasMap.set(addon.getName(), addon.getSourcesDir());

			const resolveDependency = (packageName) => {
				const nodeModulesPath = path.join(path.dirname(environment.packageJsonPath), 'node_modules');
				const packageJsonPath = require.resolve(packageName + '/package.json', {paths: [nodeModulesPath]});

				const root = path.dirname(packageJsonPath);
				const packageJSON = require(packageJsonPath);

				if (packageName === 'zombiebox') {
					aliasMap.set('zb', path.join(root, packageJSON.module));
				} else {
					const Addon = require(root);
					const addon = new Addon();
					aliasMap.set(addon.getName(), addon.getSourcesDir());
				}
			};


			const allDependencies = [
				...Object.keys(environment.packageJson.dependencies || {}),
				...Object.keys(environment.packageJson.devDependencies || {})
			];
			const otherAddons = allDependencies.filter((dependency) =>
				dependency.startsWith('zombiebox-extension') ||
				dependency.startsWith('zombiebox-platform')
			);

			otherAddons.forEach(resolveDependency);
			resolveDependency('zombiebox');

			break;
		}
		case 'application': {
			const nodeModulesPath = path.join(path.dirname(environment.packageJsonPath), 'node_modules');
			const zbIndexPath = require.resolve('zombiebox', {paths: [nodeModulesPath]});
			const {Application} = require(zbIndexPath);

			const application = new Application(path.dirname(environment.packageJsonPath), config.configs || []);

			aliasMap = new Map(application.getAliases());
			break;
		}
	}
};


const determineEnvironment = (packageJsonPath) => {
	packageJsonPath = packageJsonPath || findPackageJson(process.cwd(), (json) =>
		json.name === 'zombiebox' ||
		json.dependencies && json.dependencies.hasOwnProperty('zombiebox') ||
		json.peerDependencies && json.peerDependencies.hasOwnProperty('zombiebox') ||
		json.devDependencies && json.devDependencies.hasOwnProperty('zombiebox')
	);

	if (!packageJsonPath) {
		throw new Error('eslint-import-resolver could not determine ZombieBox environment; Try configuring it.')
	}

	const packageJson = require(packageJsonPath);
	const {name} = packageJson;
	let kind;

	if (name === 'zombiebox') {
		kind = 'zombiebox';
	} else if (
		name.startsWith('zombiebox-platform') ||
		name.startsWith('zombiebox-extension')
	) {
		kind = 'addon';
	} else {
		kind = 'application';
	}

	environment = {
		packageJsonPath,
		packageJson,
		kind
	};
};

const resolve = (source, file, config) => {
	config = {
		...config
	};

	if (!environment) {
		determineEnvironment(config.packageJson);
		constructAliasMap(config);
	}

	if (isLocalImport(source)) {
		return resolveFile(path.join(path.dirname(file), source));
	}

	const [componentName, ...parts] = source.split(path.sep);
	const absolutePath = aliasMap.get(componentName);
	if (absolutePath) {
		return resolveFile([absolutePath, ...parts].join('/'));
	}

	return {
		found: false,
		path: null,
	}
};

exports.resolve = resolve;

exports.interfaceVersion = 2;
