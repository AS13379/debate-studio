# 辩论流程与状态机

## 默认阶段

`validating -> moderating -> public_pool -> affirmative_planning -> negative_planning -> affirmative_research -> negative_research -> argument_drafting -> affirmative_opening -> negative_opening -> cross_examination -> rebuttal -> free_debate -> negative_closing -> affirmative_closing -> adjudication -> completed`

研究阶段可依次执行，或由引擎在同一公共资源快照下并行调度；无论调度方式，私有上下文绝不交叉。第一阶段建议顺序执行，降低 UI、取消与持久化复杂度。

## 会话状态

```text
draft --START--> running --PAUSE--> paused --RESUME--> running
running --STOP--> stopped
running --turn error--> waiting_retry --RETRY/SKIP/FORCE_NEXT--> running
running --finalize--> completed
```

只有 `running` 状态可发起新调用。`PAUSE` 取消在途请求并把当前轮次标为 `paused`；`STOP` 取消请求并标记会话终止；两者保留已输出的文本与事件。`FORCE_NEXT` 记录用户理由，跳过当前阶段的未完成工作。任何非法命令都返回可显示的领域错误。

## 轮次与事件

每个阶段至少有一个 `DebateTurn`，其生命周期为 `queued -> streaming -> completed | failed | cancelled | paused | skipped`。流事件附属于轮次并按序号保存。重试绝不覆盖原轮次，而创建 `retryOfTurnId` 指向原轮次的新记录，确保导出和诊断可追溯。

## 用户干预

用户问题、新证据、核验请求、轮数调整和强制总结采用显式 `DebateCommand`，并由引擎决定注入位置。例如新证据进入资产/证据桌后，在下一次上下文快照中可见；不得直接拼入所有角色的 system prompt。

## 自由辩论与未来无限模式

第一阶段自由辩论使用有限、可配置的轮数。无限模式仅定义为“周期”接口：每周期总结、重复检测、上下文快照、预算检查和用户确认；绝不以 `while (true)` 实现。

