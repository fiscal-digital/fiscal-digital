output "alerts_table_arn" {
  value = aws_dynamodb_table.alerts.arn
}

output "gazettes_table_arn" {
  value = aws_dynamodb_table.gazettes.arn
}

output "suppliers_table_arn" {
  value = aws_dynamodb_table.suppliers.arn
}

output "entities_table_arn" {
  value = aws_dynamodb_table.entities.arn
}
