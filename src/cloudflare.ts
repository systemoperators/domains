/**
 * Cloudflare Custom Hostnames API wrapper
 * All operations use fetch(), works in Workers/Node/Deno/Bun
 */

import type { CloudflareConfig, CustomHostname } from './types.js';

const CF_API = 'https://api.cloudflare.com/client/v4';

function headers(config: CloudflareConfig) {
  return {
    'Authorization': `Bearer ${config.apiToken}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Create a Custom Hostname on the zone
 */
export async function createCustomHostname(
  config: CloudflareConfig,
  hostname: string
): Promise<{ success: boolean; hostname?: CustomHostname; error?: string }> {
  try {
    const response = await fetch(
      `${CF_API}/zones/${config.zoneId}/custom_hostnames`,
      {
        method: 'POST',
        headers: headers(config),
        body: JSON.stringify({
          hostname,
          ssl: {
            method: 'http',
            type: 'dv',
            settings: {
              http2: 'on',
              min_tls_version: '1.2',
              tls_1_3: 'on',
            },
          },
        }),
      }
    );

    const data = await response.json() as any;

    if (!data.success) {
      return {
        success: false,
        error: data.errors?.[0]?.message || 'Failed to create custom hostname',
      };
    }

    return { success: true, hostname: data.result };
  } catch (error) {
    console.error('Cloudflare API error:', error);
    return { success: false, error: 'Network error' };
  }
}

/**
 * Get a Custom Hostname by ID
 */
export async function getCustomHostname(
  config: CloudflareConfig,
  hostnameId: string
): Promise<{ success: boolean; hostname?: CustomHostname; error?: string }> {
  try {
    const response = await fetch(
      `${CF_API}/zones/${config.zoneId}/custom_hostnames/${hostnameId}`,
      { headers: headers(config) }
    );

    const data = await response.json() as any;

    if (!data.success) {
      return {
        success: false,
        error: data.errors?.[0]?.message || 'Failed to get custom hostname',
      };
    }

    return { success: true, hostname: data.result };
  } catch (error) {
    console.error('Cloudflare API error:', error);
    return { success: false, error: 'Network error' };
  }
}

/**
 * Delete a Custom Hostname by ID
 */
export async function deleteCustomHostname(
  config: CloudflareConfig,
  hostnameId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(
      `${CF_API}/zones/${config.zoneId}/custom_hostnames/${hostnameId}`,
      {
        method: 'DELETE',
        headers: headers(config),
      }
    );

    const data = await response.json() as any;

    if (!data.success) {
      return {
        success: false,
        error: data.errors?.[0]?.message || 'Failed to delete custom hostname',
      };
    }

    return { success: true };
  } catch (error) {
    console.error('Cloudflare API error:', error);
    return { success: false, error: 'Network error' };
  }
}

/**
 * List Custom Hostnames, optionally filtered by hostname
 */
export async function listCustomHostnames(
  config: CloudflareConfig,
  filter?: string
): Promise<{ success: boolean; hostnames?: CustomHostname[]; error?: string }> {
  try {
    const url = new URL(`${CF_API}/zones/${config.zoneId}/custom_hostnames`);

    if (filter) {
      url.searchParams.set('hostname', filter);
    }

    const response = await fetch(url.toString(), {
      headers: headers(config),
    });

    const data = await response.json() as any;

    if (!data.success) {
      return {
        success: false,
        error: data.errors?.[0]?.message || 'Failed to list custom hostnames',
      };
    }

    return { success: true, hostnames: data.result };
  } catch (error) {
    console.error('Cloudflare API error:', error);
    return { success: false, error: 'Network error' };
  }
}

/**
 * Parse SSL status from a Custom Hostname object
 */
export function getSSLStatus(hostname: CustomHostname): {
  status: 'active' | 'pending' | 'error';
  message: string;
} {
  if (hostname.ssl.status === 'active') {
    return { status: 'active', message: 'SSL certificate active' };
  }

  if (hostname.ssl.status === 'pending_validation') {
    return { status: 'pending', message: 'Waiting for DNS validation' };
  }

  if (hostname.ssl.status === 'pending_issuance') {
    return { status: 'pending', message: 'Issuing SSL certificate' };
  }

  if (hostname.ssl.status === 'validation_timed_out') {
    return { status: 'error', message: 'SSL validation timed out - domain may not be pointing correctly' };
  }

  if (hostname.ssl.validation_errors && hostname.ssl.validation_errors.length > 0) {
    return {
      status: 'error',
      message: hostname.ssl.validation_errors[0].message,
    };
  }

  return { status: 'pending', message: 'Processing' };
}
