# Publishing flux-vector to npm

This guide walks you through publishing `flux-vector` as an npm package.

## Prerequisites

1. **npm account**: Create one at [npmjs.com](https://www.npmjs.com/signup)
2. **Login**: Run `npm login` in your terminal
3. **Build**: Ensure the package builds successfully with `npm run build`

## Pre-Publication Checklist

### 1. Update package.json

Before publishing, make sure to fill in:
- ✅ `author`: Your name/email or organization
- ✅ `repository.url`: Your Git repository URL
- ✅ `bugs.url`: URL to your issue tracker (usually `${repository.url}/issues`)
- ✅ `homepage`: Your project homepage (usually `${repository.url}#readme`)
- ✅ `version`: Bump version if needed (see [Semantic Versioning](#versioning))

### 2. Verify Package Contents

Check what will be published:
```bash
npm pack --dry-run
```

This should show:
- `dist/**/*` - Compiled JavaScript and TypeScript definitions
- `README.md` - Main documentation
- `ARCHITECTURE.md` - Technical documentation
- `LICENSE` - License file
- `package.json` - Package configuration

### 3. Test Installation Locally

Before publishing, test the package locally:

```bash
# Create a test package
npm pack

# In another project, install it
npm install ../flux-vector/flux-vector-1.0.0.tgz

# Or use npm link
npm link
cd /path/to/test-project
npm link flux-vector
```

## Publishing Steps

### Step 1: Build the Package

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` folder.

### Step 2: Check Package Name Availability

```bash
npm view flux-vector
```

If the package name is taken, you'll need to:
- Choose a different name (update `name` in `package.json`)
- Or use a scoped package: `@your-username/flux-vector`

### Step 3: Login to npm

```bash
npm login
```

Enter your:
- Username
- Password
- Email address
- OTP (if two-factor auth is enabled)

### Step 4: Publish (Dry Run First)

Test the publication process:

```bash
npm publish --dry-run
```

This simulates publishing without actually publishing.

### Step 5: Publish to npm

**For first-time publishing (public package):**
```bash
npm publish --access public
```

**For scoped packages (@your-username/flux-vector):**
```bash
npm publish --access public
```

**For subsequent versions:**
```bash
npm publish
```

### Step 6: Verify Publication

1. Check npm registry: https://www.npmjs.com/package/flux-vector
2. Test installation in a clean project:
   ```bash
   npm install flux-vector
   ```

## Versioning

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.0.0 → 2.0.0): Breaking changes
- **MINOR** (1.0.0 → 1.1.0): New features (backward compatible)
- **PATCH** (1.0.0 → 1.0.1): Bug fixes (backward compatible)

### Update Version

```bash
# Patch version (1.0.0 → 1.0.1)
npm version patch

# Minor version (1.0.0 → 1.1.0)
npm version minor

# Major version (1.0.0 → 2.0.0)
npm version major
```

This will:
1. Update `version` in `package.json`
2. Create a git commit
3. Create a git tag

Then publish:
```bash
npm publish
```

## Package Configuration Explained

### Entry Points

The package exports:
- **Main entry**: `import VectorSearchManager from 'flux-vector'`
- **Embeddings only**: `import { VectorSearchManager } from 'flux-vector/embeddings'`
- **Document processing**: `import { DocumentProcessor } from 'flux-vector/document-processing'`

### Files Included

Only these are published (see `files` field in `package.json`):
- `dist/**/*` - Compiled code
- `README.md` - Documentation
- `ARCHITECTURE.md` - Technical docs
- `LICENSE` - License

Everything else is excluded via `.npmignore`.

## Common Issues & Solutions

### Issue: "Package name already taken"

**Solution**: Use a scoped package:
```json
{
  "name": "@your-username/flux-vector"
}
```

Install with:
```bash
npm install @your-username/flux-vector
```

### Issue: "You cannot publish over the previously published versions"

**Solution**: Bump the version:
```bash
npm version patch
npm publish
```

### Issue: "Invalid tag name"

**Solution**: Check your version number in `package.json`. It must follow semantic versioning (e.g., `1.0.0`, not `1.0` or `v1.0.0`).

### Issue: Large package size

The package is ~115KB compressed, ~530KB unpacked. This is normal because:
- TypeScript definitions are included
- Mememo library code is included
- Documentation files are included

If you need to reduce size:
1. Review `.npmignore` to exclude unnecessary files
2. Remove example files from `dist/` (already excluded)
3. Consider splitting into separate packages

## Unpublishing (Use with Caution)

⚠️ **Warning**: Only unpublish within 72 hours of initial publish, or use `deprecate` instead.

### Deprecate (Recommended)

Deprecate a version instead of unpublishing:
```bash
npm deprecate flux-vector@1.0.0 "This version has critical bugs. Please upgrade to 1.0.1"
```

### Unpublish (Last Resort)

```bash
# Unpublish a specific version
npm unpublish flux-vector@1.0.0

# Unpublish entire package (only within 72 hours)
npm unpublish flux-vector --force
```

## Post-Publication

1. **Create a GitHub release** with the same version tag
2. **Update documentation** if needed
3. **Announce** on social media/forums if appropriate
4. **Monitor** npm stats and GitHub issues

## Continuous Publishing with CI/CD

You can automate publishing with GitHub Actions:

```yaml
# .github/workflows/publish.yml
name: Publish to npm

on:
  release:
    types: [created]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run build
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{secrets.NPM_TOKEN}}
```

## Resources

- [npm Documentation](https://docs.npmjs.com/)
- [Semantic Versioning](https://semver.org/)
- [npm Package Best Practices](https://docs.npmjs.com/packages-and-modules/contributing-packages-to-the-registry)

