import { FlatCompat } from '@eslint/eslintrc';
import base from '@bms/config/eslint';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [...base, ...compat.extends('next/core-web-vitals')];
export default config;
