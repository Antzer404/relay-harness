import { isCredentialError } from '@shared/error-codes'

export interface RuntimeFailureText {
  message: string
  retryable: boolean
  /** The underlying transport failed rather than the model rejecting the call. */
  network: boolean
}

const NETWORK_PATTERN =
  /fetch failed|econnrefused|econnreset|enotfound|etimedout|eai_again|network|socket|proxy|tls|certificate|dns/i

function isNetworkDetail(detail: string): boolean {
  return NETWORK_PATTERN.test(detail)
}

/**
 * Turns provider/CLI error codes into an actionable sentence. The raw detail
 * stays attached for debugging, but the first line tells the user what to do.
 */
export function describeRuntimeFailure(code: string, detail: string): RuntimeFailureText {
  const raw = detail.trim()
  const network = isNetworkDetail(raw)
  const withDetail = (message: string): string => (raw ? `${message}\n${raw}` : message)

  if (isCredentialError(code)) {
    switch (code) {
      case 'authentication_failed':
      case 'no_api_key':
        return {
          message: withDetail('API Key 无效或未配置。请在设置 → API Key 中更新后重试。'),
          retryable: false,
          network: false
        }
      case 'billing_error':
        return {
          message: withDetail('DeepSeek 账户余额不足或计费异常，请检查账户后重试。'),
          retryable: false,
          network: false
        }
      case 'account_on_hold':
      case 'verification_required':
        return {
          message: withDetail('DeepSeek 账号状态异常（待验证或已暂停），请先处理账户后再试。'),
          retryable: false,
          network: false
        }
      case 'oauth_org_not_allowed':
        return {
          message: withDetail('当前账号不允许通过此方式访问模型，请检查账户权限。'),
          retryable: false,
          network: false
        }
      default:
        return {
          message: withDetail('API 凭证不可用，请检查设置中的 Key、端点与代理配置。'),
          retryable: false,
          network
        }
    }
  }

  switch (code) {
    case 'rate_limit':
      return {
        message: withDetail('请求过于频繁，稍后会自动重试。'),
        retryable: true,
        network: false
      }
    case 'overloaded':
      return {
        message: withDetail('模型服务繁忙，稍后会自动重试。'),
        retryable: true,
        network: false
      }
    case 'server_error':
      return {
        message: withDetail('模型服务暂时不可用，稍后会自动重试。'),
        retryable: true,
        network: false
      }
    case 'max_output_tokens':
      return {
        message: withDetail('输出达到上限被截断，可以重试或把任务拆小。'),
        retryable: true,
        network: false
      }
    case 'invalid_request':
      return {
        message: withDetail('请求参数无效，请检查模型与工作区配置后重试。'),
        retryable: false,
        network: false
      }
    case 'model_not_found':
      return {
        message: withDetail('模型不可用，请在设置中检查模型名称。'),
        retryable: false,
        network: false
      }
    case 'runtime_failure':
      return network
        ? {
            message: withDetail('无法连接 API 端点，请检查网络或代理设置。'),
            retryable: true,
            network: true
          }
        : {
            message: withDetail('运行时异常。可以重试上一条消息，Relay 会自动重建会话。'),
            retryable: true,
            network: false
          }
    default:
      if (network) {
        return {
          message: withDetail('无法连接 API 端点，请检查网络或代理设置。'),
          retryable: true,
          network: true
        }
      }
      return {
        message: raw || `运行时错误（${code}）`,
        retryable: false,
        network: false
      }
  }
}
