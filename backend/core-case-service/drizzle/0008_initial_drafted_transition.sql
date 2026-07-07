ALTER TABLE "stage_transition" DROP CONSTRAINT "stage_transition_valid_edge_check";--> statement-breakpoint
ALTER TABLE "stage_transition" ADD CONSTRAINT "stage_transition_valid_edge_check" CHECK ((
                ("stage_transition"."from_stage" = 'Drafted' and "stage_transition"."to_stage" = 'Drafted' and "stage_transition"."reason" = 'report_created')
                or ("stage_transition"."from_stage" = 'Drafted' and "stage_transition"."to_stage" = 'Submitted')
                or ("stage_transition"."from_stage" = 'Submitted' and "stage_transition"."to_stage" = 'Manager Approval')
                or ("stage_transition"."from_stage" = 'Manager Approval' and "stage_transition"."to_stage" = 'AP Review')
                or ("stage_transition"."from_stage" = 'AP Review' and "stage_transition"."to_stage" = 'Paid')
                or ("stage_transition"."from_stage" = 'Paid' and "stage_transition"."to_stage" = 'Reconciled')
                or ("stage_transition"."from_stage" = 'Manager Approval' and "stage_transition"."to_stage" = 'Drafted')
                or ("stage_transition"."from_stage" = 'AP Review' and "stage_transition"."to_stage" = 'Drafted')
            ));
