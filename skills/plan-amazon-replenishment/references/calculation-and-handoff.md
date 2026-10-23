# 计算能力复用与交接

## 复用而不重复建公式引擎

当前项目有合适计算器时先读其实际输入、范围和状态语义。记录路径/版本或哈希及本次输入，不以“存在一个脚本”证明覆盖本问题。没有合适引擎时可在本次输出目录做透明Decimal/整数件数和日期计算，保留输入/公式/校验；不得声称经过不存在的自动拦截。

在本技能相邻的 select-amazon-products 已安装时，可复用其 references/replenishment-and-seasonality.md 和 scripts/calculate_replenishment_plan.py；先确认文件存在并读参考及参数。它支持给定恒定日需下的路线交期、触发、桥接量，不抓库存、不做预测、不分配颜色、不做分批动态在途。

它的JSON核心输入为as_of_date、last_economic_fba_arrival_date、inventory_position_units及scope、planning_daily_demand_units、safety_stock_days、planned_reorder_quantity_units、primary_route_id和可选bridge_route_id、routes。路线包括route_id、quantity_min/max_units和production_days、qc_prep_days、transit_days、customs_buffer_days、fba_receiving_days、risk_buffer_days。未知留null，不能为通过结构校验补零。解析为绝对路径，通过--input输入文件或标准输入；不依赖项目当前目录。

只有库存全部可在起点使用、恒定日销假设适用时，才把该脚本的库存续航/桥接量当本问题计算。不要将未来到货总数塞进inventory_position_units后解释为当前不断货。脚本COMPLETE/AVAILABLE/READY仅是其内部条件，仍需核对来源、预测、现金及桥接具体状态；不是可采购或可投广告。缺经济到仓日的常青品可保留PROVISIONAL算术，不伪造日期追求READY。

需要颜色分配或逐日投影时按需求参考计算，不复制整套旧引擎。至少核对：单件/箱单位、总量守恒、各SKU余额、当前与未来供给互斥、缺货前后时序、未被重复计入的安全余量、MOQ/数量档、现金、最后经济窗口。报价/FX使用同币种有日期来源，资金是否可用需要用户/账务证据而非默认。

## 跨模块交接

保留project_id、产品/变体身份、operating_context及context_id/operating_context_sha256（如提供）；验证已有哈希。新观察另建带时间版本，不改旧包。项目提供共享版本注册表时，按其现行规范引用精确id/version/sha256；失效、范围不符或内容变化时停止受影响计算，不静默替换最新值。没有注册表的项目可保留普通证据清单，不强制安装全套框架。

向广告交付当前精确Offer可售事实、预留包含关系、安全余量、未来各批供给、预计可售日期和断货风险；不要直接把海外仓/在途加成广告可用库存。若广告计算器的gross/reserved模型与源API不同，先做可追溯映射，不能重复扣平台已排除的reserved。只提供风险与约束，不修改预算/状态。

向利润交付SKU/批次、采购数量与成本、运费和分摊依据、实际付款/应付状态、已售/未售范围；采购现金不能全当本期已售成本。同一次补货不在利润与库存里各扣一次货值。实际结账由利润工作流完成。

完整计划可以保存一份plan及来源清单，包含范围/as_of、mode、需求/供给行、路线/箱规、方案及合计、计算依据、缺口、审批与执行状态；小查询不强制JSON包或Excel。不要在现有项目新增强制阶段、变更定时任务或重写全部当前状态。
