/* @flow */

import { install } from './install' // 导入安装方法
import { START } from './util/route'
import { assert } from './util/warn'
import { inBrowser } from './util/dom'
import { cleanPath } from './util/path'
import { createMatcher } from './create-matcher'
import { normalizeLocation } from './util/location'
import { supportsPushState } from './util/push-state'

import { HashHistory } from './history/hash'
import { HTML5History } from './history/html5'
import { AbstractHistory } from './history/abstract'

import type { Matcher } from './create-matcher'

export default class VueRouter {
  static install: () => void
  static version: string

  app: any
  apps: Array<any>
  ready: boolean
  readyCbs: Array<Function>
  options: RouterOptions
  mode: string
  history: HashHistory | HTML5History | AbstractHistory
  matcher: Matcher
  fallback: boolean
  beforeHooks: Array<?NavigationGuard> // beforeEach hooks
  resolveHooks: Array<?NavigationGuard> // beforeResolve hooks
  afterHooks: Array<?AfterNavigationHook> // afterEach hooks

  constructor(options: RouterOptions = {}) {
    this.app = null
    this.apps = []
    this.options = options
    this.beforeHooks = []
    this.resolveHooks = []
    this.afterHooks = []
    this.matcher = createMatcher(options.routes || [], this) // 创建路由matcher对象，传入routes路由配置列表及VueRouter实例

    let mode = options.mode || 'hash'
    this.fallback =
      mode === 'history' && !supportsPushState && options.fallback !== false
    if (this.fallback) {
      mode = 'hash'
    }
    // 非浏览器环境，强制使用abstract模式
    if (!inBrowser) {
      mode = 'abstract'
    }
    this.mode = mode

    // 根据不同mode，实例化不同history实例
    switch (mode) {
      case 'history':
        this.history = new HTML5History(this, options.base)
        break
      case 'hash':
        this.history = new HashHistory(this, options.base, this.fallback)
        break
      case 'abstract':
        this.history = new AbstractHistory(this, options.base)
        break
      default:
        if (process.env.NODE_ENV !== 'production') {
          assert(false, `invalid mode: ${mode}`)
        }
    }
  }

  // 获取匹配的路由对象
  match(raw: RawLocation, current?: Route, redirectedFrom?: Location): Route {
    return this.matcher.match(raw, current, redirectedFrom)
  }
  // 获取当前路由信息对象
  get currentRoute(): ?Route {
    return this.history && this.history.current
  }

  // 初始化,app为Vue根实例
  init(app: any /* Vue component instance */) {
    // 开发环境，确保已经安装VueRouter
    process.env.NODE_ENV !== 'production' &&
      assert(
        install.installed,
        `not installed. Make sure to call \`Vue.use(VueRouter)\` ` +
          `before creating root instance.`
      )

    this.apps.push(app) // 保存实例

    // set up app destroyed handler
    // https://github.com/vuejs/vue-router/issues/2639
    // 绑定destroyed hook，避免内存泄露
    app.$once('hook:destroyed', () => {
      // clean out app from this.apps array once destroyed
      const index = this.apps.indexOf(app)
      if (index > -1) this.apps.splice(index, 1)
      // ensure we still have a main app or null if no apps
      // we do not release the router so it can be reused
      // 需要确保始终有个主应用
      if (this.app === app) this.app = this.apps[0] || null
    })

    // main app previously initialized
    // return as we don't need to set up new history listener
    // main app已经存在，则不需要重复初始化history 的事件监听
    if (this.app) {
      return
    }

    this.app = app

    const history = this.history

    if (history instanceof HTML5History) {
      // 若是HTML5History类，则直接调用父类的transitionTo方法，跳转到当前location
      history.transitionTo(history.getCurrentLocation())
    } else if (history instanceof HashHistory) {
      // 若是HashHistory，在调用父类的transitionTo方法后，并传入onComplete、onAbort回调
      const setupHashListener = () => {
        // 调用HashHistory.setupListeners方法，设置hashchange监听
        // 在 route 切换完成之后再设置 hashchange 的监听,
        // 修复https://github.com/vuejs/vue-router/issues/725
        // 因为如果钩子函数 beforeEnter 是异步的话, beforeEnter 钩子就会被触发两次. 因为在初始化时, 如果此时的 hash 值不是以 / 开头的话就会补上 #/, 这个过程会触发 hashchange 事件, 就会再走一次生命周期钩子, 也就意味着会再次调用 beforeEnter 钩子函数.
        history.setupListeners()
      }
      // transitionTo这个就是进行组件的渲染，里面调用match方法，match方法里会调用_createRoute方法，_createRoute会调用createRoute来创建路由
      history.transitionTo(
        history.getCurrentLocation(),
        setupHashListener, // transitionTo的onComplete回调
        setupHashListener // transitionTo的onAbort回调
      )
    }
    // 调用父类的listen方法，添加回调；
    // 回调会在父类的updateRoute方法被调用时触发，重新为app._route赋值，依赖app._route的组件(route-view组件)都会被重新渲染
    history.listen(route => {
      this.apps.forEach(app => {
        // 由于app._route被定义为响应式，所以app._route发生变化，watcher监听到改变，那么调用 render 方法进行重新渲染，
        app._route = route
      })
    })
  }
  // 注册beforeEach守卫
  beforeEach(fn: Function): Function {
    return registerHook(this.beforeHooks, fn)
  }
  // 注册beforeResolve守卫
  beforeResolve(fn: Function): Function {
    return registerHook(this.resolveHooks, fn)
  }
  // 注册afterEach钩子
  afterEach(fn: Function): Function {
    return registerHook(this.afterHooks, fn)
  }
  // 注册history的ready回调
  onReady(cb: Function, errorCb?: Function) {
    this.history.onReady(cb, errorCb)
  }
  // 注册history的error回调
  onError(errorCb: Function) {
    this.history.onError(errorCb)
  }
  // 添加一条路由记录
  push(location: RawLocation, onComplete?: Function, onAbort?: Function) {
    // $flow-disable-line
    if (!onComplete && !onAbort && typeof Promise !== 'undefined') {
      return new Promise((resolve, reject) => {
        this.history.push(location, resolve, reject)
      })
    } else {
      this.history.push(location, onComplete, onAbort)
    }
  }
  // 替换一条路由记录
  replace(location: RawLocation, onComplete?: Function, onAbort?: Function) {
    // $flow-disable-line
    if (!onComplete && !onAbort && typeof Promise !== 'undefined') {
      return new Promise((resolve, reject) => {
        this.history.replace(location, resolve, reject)
      })
    } else {
      this.history.replace(location, onComplete, onAbort)
    }
  }
  // 动态的导航到一个新 URL
  go(n: number) {
    this.history.go(n)
  }
  // 后退
  back() {
    this.go(-1)
  }
  // 前进
  forward() {
    this.go(1)
  }
  // 返回目标位置或是当前路由匹配的组件数组 (是数组的定义/构造类，不是实例)。通常在服务端渲染的数据预加载时使用
  getMatchedComponents(to?: RawLocation | Route): Array<any> {
    const route: any = to
      ? to.matched
        ? to
        : this.resolve(to).route
      : this.currentRoute
    if (!route) {
      return []
    }
    return [].concat.apply(
      [],
      route.matched.map(m => {
        return Object.keys(m.components).map(key => {
          return m.components[key]
        })
      })
    )
  }
  // 解析目标位置
  resolve(
    to: RawLocation,
    current?: Route,
    append?: boolean
  ): {
    location: Location,
    route: Route,
    href: string,
    // for backwards compat
    normalizedTo: Location,
    resolved: Route
  } {
    current = current || this.history.current
    const location = normalizeLocation(to, current, append, this)
    const route = this.match(location, current) // 获取匹配的route
    const fullPath = route.redirectedFrom || route.fullPath
    const base = this.history.base
    const href = createHref(base, fullPath, this.mode)
    return {
      location,
      route,
      href,
      // for backwards compat
      normalizedTo: location,
      resolved: route
    }
  }
  // 动态添加更多的路由规则
  addRoutes(routes: Array<RouteConfig>) {
    this.matcher.addRoutes(routes)
    if (this.history.current !== START) {
      this.history.transitionTo(this.history.getCurrentLocation())
    }
  }
}

// 注册守卫，并返回卸载函数
function registerHook(list: Array<any>, fn: Function): Function {
  list.push(fn)
  return () => {
    const i = list.indexOf(fn)
    if (i > -1) list.splice(i, 1)
  }
}
// 创建href
function createHref(base: string, fullPath: string, mode) {
  var path = mode === 'hash' ? '#' + fullPath : fullPath
  return base ? cleanPath(base + '/' + path) : path
}

VueRouter.install = install // 挂载安装方法，Vue.use时，自动调用install方法
VueRouter.version = '__VERSION__'
// 浏览器环境，自动安装VueRouter
if (inBrowser && window.Vue) {
  window.Vue.use(VueRouter)
}
